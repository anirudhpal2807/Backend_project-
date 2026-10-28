import { Injectable, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { UnitOfWork } from '../../infra/db/unit-of-work';
import { MockPaymentProvider } from './providers/mock-payment-provider';
import { CreatePaymentIntentDto, PaymentWebhookPayload } from './dto/payment.dto';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { OutboxService } from '../../infra/queue/outbox.service';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { UuidV7IdGenerator } from '../../common/id/uuidv7-id-generator';
import { ConsultationStateMachine } from '../bookings/domain/consultation-state-machine';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly paymentProvider: MockPaymentProvider,
    private readonly outboxService: OutboxService,
    private readonly logger: AppLoggerService,
    private readonly idGenerator: UuidV7IdGenerator,
  ) {}

  public async createPaymentIntent(
    patientId: string,
    dto: CreatePaymentIntentDto,
    idempotencyKey?: string,
  ) {
    const consultation = await this.dbService.db
      .selectFrom('consultations')
      .selectAll()
      .where('id', '=', dto.consultation_id)
      .executeTakeFirst();

    if (!consultation) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Consultation not found');
    }

    if (consultation.patient_id !== patientId) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Access denied to this consultation',
      );
    }

    if (consultation.status !== 'PENDING_PAYMENT') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ILLEGAL_STATE_TRANSITION,
        `Cannot create payment intent for consultation in status '${consultation.status}'`,
      );
    }

    const doctor = await this.dbService.db
      .selectFrom('doctors')
      .select(['consultation_fee'])
      .where('id', '=', consultation.doctor_id)
      .executeTakeFirst();

    const feeAmount = doctor?.consultation_fee ?? 1000;

    const intent = await this.paymentProvider.createIntent({
      amount: feeAmount,
      currency: 'INR',
      consultationId: consultation.id,
      patientId: consultation.patient_id,
      idempotencyKey,
    });

    return intent;
  }

  public async handleWebhook(
    rawPayload: string,
    signature: string,
    payload: PaymentWebhookPayload,
  ) {
    // 1. Signature verification
    const isValidSignature = this.paymentProvider.verifyWebhookSignature(rawPayload, signature);
    if (!isValidSignature) {
      this.logger.warn('Payment webhook signature verification failed');
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.SIGNATURE_VERIFICATION_FAILED,
        'Invalid webhook signature',
      );
    }

    // 2. Timestamp tolerance (5 minutes)
    const currentSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(currentSeconds - payload.created) > 300) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BAD_REQUEST,
        'Webhook payload timestamp is outside acceptable tolerance',
      );
    }

    // 3. Replay prevention with processed_webhooks
    const provider = 'MOCK_STRIPE';
    const processedId = this.idGenerator.generate();

    return this.uow.withTransaction(async trx => {
      const alreadyProcessed = await trx
        .insertInto('processed_webhooks')
        .values({
          id: processedId,
          provider,
          event_id: payload.id,
          processed_at: new Date(),
        })
        .onConflict(oc => oc.columns(['provider', 'event_id']).doNothing())
        .returning('id')
        .executeTakeFirst();

      if (!alreadyProcessed) {
        this.logger.log(`Webhook event ${payload.id} already processed. Skipping idempotently.`);
        return { status: 'already_processed' };
      }

      if (payload.type === 'payment_intent.succeeded') {
        const consultationId = payload.data.metadata.consultation_id;
        const consultation = await trx
          .selectFrom('consultations')
          .selectAll()
          .where('id', '=', consultationId)
          .forUpdate()
          .executeTakeFirst();

        if (!consultation) {
          this.logger.error(`Consultation ${consultationId} not found during webhook processing`);
          return { status: 'consultation_not_found' };
        }

        const slot = await trx
          .selectFrom('availability_slots')
          .selectAll()
          .where('id', '=', consultation.slot_id)
          .forUpdate()
          .executeTakeFirst();

        const now = new Date();
        const isHoldExpired =
          slot?.held_until && new Date(slot.held_until).getTime() < now.getTime();

        // Check if consultation can be confirmed
        if (
          consultation.status === 'PENDING_PAYMENT' &&
          slot?.status === 'HELD' &&
          !isHoldExpired
        ) {
          // Transition consultation state machine
          ConsultationStateMachine.assertCanTransition(consultation.status, 'CONFIRMED', 'SYSTEM');

          // Update consultation
          await trx
            .updateTable('consultations')
            .set({
              status: 'CONFIRMED',
              updated_at: now,
            })
            .where('id', '=', consultation.id)
            .execute();

          // Update slot
          await trx
            .updateTable('availability_slots')
            .set({
              status: 'BOOKED',
              updated_at: now,
            })
            .where('id', '=', slot.id)
            .execute();

          // Insert payment record
          const paymentId = this.idGenerator.generate();
          await trx
            .insertInto('payments')
            .values({
              id: paymentId,
              consultation_id: consultation.id,
              amount: payload.data.amount,
              currency: payload.data.currency,
              status: 'SUCCEEDED',
              provider,
              provider_payment_id: payload.data.id,
              created_at: now,
              updated_at: now,
            })
            .execute();

          // Outbox event
          await this.outboxService.publishInTransaction(
            trx,
            'consultation.confirmed',
            'consultation',
            consultation.id,
            {
              consultationId: consultation.id,
              slotId: slot.id,
              patientId: consultation.patient_id,
              doctorId: consultation.doctor_id,
              amount: payload.data.amount,
            },
          );

          this.logger.log(`Consultation ${consultation.id} confirmed successfully`);
          return { status: 'confirmed', consultationId: consultation.id };
        }

        // COMPENSATION PATH: Late payment arrived after hold expiry or slot cancelled
        this.logger.warn(
          `Late payment arrived for consultation ${consultation.id} (Status: ${consultation.status}, Slot Status: ${slot?.status}). Initiating auto-refund.`,
        );

        const refundResult = await this.paymentProvider.refund({
          paymentIntentId: payload.data.id,
          amount: payload.data.amount,
          reason: 'Late payment received after slot hold expired',
        });

        // Insert payment record as REFUNDED
        const paymentId = this.idGenerator.generate();
        await trx
          .insertInto('payments')
          .values({
            id: paymentId,
            consultation_id: consultation.id,
            amount: payload.data.amount,
            currency: payload.data.currency,
            status: 'REFUNDED',
            provider,
            provider_payment_id: payload.data.id,
            created_at: now,
            updated_at: now,
          })
          .execute();

        await this.outboxService.publishInTransaction(
          trx,
          'consultation.auto_refunded',
          'consultation',
          consultation.id,
          {
            consultationId: consultation.id,
            refundId: refundResult.refundId,
            amount: payload.data.amount,
            reason: 'Late payment auto-refunded',
          },
        );

        return {
          status: 'late_payment_refunded',
          consultationId: consultation.id,
          refundId: refundResult.refundId,
        };
      }

      return { status: 'ignored_event' };
    });
  }

  public async refundPayment(params: { consultationId: string; amount: number; reason: string }) {
    const payment = await this.dbService.db
      .selectFrom('payments')
      .selectAll()
      .where('consultation_id', '=', params.consultationId)
      .where('status', '=', 'SUCCEEDED')
      .executeTakeFirst();

    if (!payment) {
      this.logger.warn(
        `No captured payment found for consultation ${params.consultationId} to refund`,
      );
      return null;
    }

    const refund = await this.paymentProvider.refund({
      paymentIntentId: payment.provider_payment_id,
      amount: params.amount,
      reason: params.reason,
    });

    await this.dbService.db
      .updateTable('payments')
      .set({
        status: 'REFUNDED',
        updated_at: new Date(),
      })
      .where('id', '=', payment.id)
      .execute();

    return refund;
  }
}
