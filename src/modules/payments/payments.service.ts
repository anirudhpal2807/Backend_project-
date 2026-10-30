import { Injectable, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { UnitOfWork } from '../../infra/db/unit-of-work';
import { MockPaymentProvider } from './providers/mock-payment-provider';
import { CashfreePaymentProvider } from './providers/cashfree-payment-provider';
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
    private readonly mockProvider: MockPaymentProvider,
    private readonly cashfreeProvider: CashfreePaymentProvider,
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

    const feeAmount = Number(doctor?.consultation_fee ?? 800);

    // Get patient user details for Cashfree customer details
    const user = await this.dbService.db
      .selectFrom('users')
      .select(['email'])
      .where('id', '=', patientId)
      .executeTakeFirst();

    // Prefer Cashfree if configured
    if (this.cashfreeProvider.isConfigured()) {
      try {
        const intent = await this.cashfreeProvider.createIntent({
          amount: feeAmount,
          currency: 'INR',
          consultationId: consultation.id,
          patientId: consultation.patient_id,
          patientEmail: user?.email,
          idempotencyKey,
        });
        return intent;
      } catch (err: unknown) {
        this.logger.warn(`Cashfree order creation failed, falling back to mock: ${(err as Error).message}`);
      }
    }

    const intent = await this.mockProvider.createIntent({
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
    payload: any,
    timestamp?: string,
  ) {
    // 1. Signature verification (supports Cashfree HMAC and Mock HMAC)
    const isCashfreeSigValid = this.cashfreeProvider.verifyWebhookSignature(rawPayload, signature, timestamp);
    const isMockSigValid = this.mockProvider.verifyWebhookSignature(rawPayload, signature);

    if (!isCashfreeSigValid && !isMockSigValid) {
      this.logger.warn('Payment webhook signature verification failed for both providers');
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.SIGNATURE_VERIFICATION_FAILED,
        'Invalid webhook signature',
      );
    }

    // 2. Extract normalized webhook data
    const isCashfreeFormat = Boolean(payload?.data?.order || payload?.data?.payment);
    let eventId: string;
    let providerName: string;
    let consultationId: string | null = null;
    let amount: number = 75000;
    let currency: string = 'INR';
    let isSuccess = false;

    if (isCashfreeFormat) {
      providerName = 'CASHFREE';
      const order = payload.data?.order || {};
      const payment = payload.data?.payment || {};
      const orderId = String(order.order_id || payload.order_id || '');
      const cfPaymentId = payment.cf_payment_id || orderId;
      eventId = `cf_evt_${cfPaymentId}_${Date.now()}`;

      const orderStatus = (order.order_status || '').toUpperCase();
      const paymentStatus = (payment.payment_status || '').toUpperCase();
      const eventType = (payload.type || '').toUpperCase();

      isSuccess =
        orderStatus === 'PAID' ||
        paymentStatus === 'SUCCESS' ||
        eventType.includes('SUCCESS');

      amount = Math.round(Number(order.order_amount || payment.payment_amount || 750) * 100);
      currency = order.order_currency || payment.payment_currency || 'INR';

      // Extract consultationId from order tags or order_id
      const tags = order.order_tags || {};
      consultationId = tags.consultation_id || null;
      if (!consultationId && orderId.startsWith('AMRUTAM-')) {
        const parts = orderId.split('-');
        if (parts.length >= 2) {
          // Check by UUID matching prefix
          const matchPrefix = parts[1].toLowerCase();
          const found = await this.dbService.db
            .selectFrom('consultations')
            .select(['id'])
            .where('id', 'like', `${matchPrefix}%`)
            .executeTakeFirst();
          if (found) consultationId = found.id;
        }
      }
    } else {
      providerName = 'MOCK_STRIPE';
      eventId = payload.id || `evt_${Date.now()}`;
      isSuccess = payload.type === 'payment_intent.succeeded';
      amount = payload.data?.amount ?? 75000;
      currency = payload.data?.currency ?? 'INR';
      consultationId = payload.data?.metadata?.consultation_id ?? null;
    }

    if (!isSuccess) {
      this.logger.log(`Received non-success payment webhook event: ${payload.type || 'UNKNOWN'}. Ignored.`);
      return { status: 'non_success_event_ignored' };
    }

    if (!consultationId) {
      this.logger.error('Webhook payload missing consultation ID');
      return { status: 'missing_consultation_id' };
    }

    const processedId = this.idGenerator.generate();

    return this.uow.withTransaction(async trx => {
      const alreadyProcessed = await trx
        .insertInto('processed_webhooks')
        .values({
          id: processedId,
          provider: providerName,
          event_id: eventId,
          processed_at: new Date(),
        })
        .onConflict(oc => oc.columns(['provider', 'event_id']).doNothing())
        .returning('id')
        .executeTakeFirst();

      if (!alreadyProcessed) {
        this.logger.log(`Webhook event ${eventId} already processed. Skipping idempotently.`);
        return { status: 'already_processed' };
      }

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
            amount,
            currency,
            status: 'SUCCEEDED',
            provider: providerName,
            provider_payment_id: eventId,
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
            amount,
            provider: providerName,
          },
        );

        this.logger.log(`Consultation ${consultation.id} confirmed successfully via ${providerName}`);
        return { status: 'confirmed', consultationId: consultation.id, provider: providerName };
      }

      // COMPENSATION PATH: Late payment arrived after hold expiry
      this.logger.warn(
        `Late payment arrived for consultation ${consultation.id} via ${providerName}. Initiating auto-refund.`,
      );

      const refundResult = await this.paymentProviderRefund(providerName, eventId, amount);

      const paymentId = this.idGenerator.generate();
      await trx
        .insertInto('payments')
        .values({
          id: paymentId,
          consultation_id: consultation.id,
          amount,
          currency,
          status: 'REFUNDED',
          provider: providerName,
          provider_payment_id: eventId,
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
          amount,
          refundId: refundResult?.refundId,
        },
      );

      return {
        status: 'late_payment_refunded',
        consultationId: consultation.id,
        refundId: refundResult?.refundId,
      };
    });
  }

  private async paymentProviderRefund(provider: string, paymentId: string, amount: number) {
    if (provider === 'CASHFREE') {
      return await this.cashfreeProvider.refund({
        paymentIntentId: paymentId,
        amount: amount / 100,
        reason: 'Hold window expired',
      });
    }
    return await this.mockProvider.refund({
      paymentIntentId: paymentId,
      amount,
      reason: 'Late payment auto-refunded',
    });
  }

  public async verifyCashfreeOrder(orderId: string) {
    const cfOrder = await this.cashfreeProvider.getOrder(orderId);
    if (!cfOrder) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Cashfree order not found');
    }

    const orderStatus = String(cfOrder.order_status || '').toUpperCase();

    if (orderStatus === 'PAID') {
      // Simulate webhook handling to confirm consultation
      const dummyPayload = {
        data: {
          order: cfOrder,
          payment: { payment_status: 'SUCCESS', cf_payment_id: orderId },
        },
        type: 'PAYMENT_SUCCESS_WEBHOOK',
      };
      const dummyRaw = JSON.stringify(dummyPayload);
      const signature = this.cashfreeProvider.generateWebhookSignature(dummyRaw);

      await this.handleWebhook(dummyRaw, signature, dummyPayload);
    }

    return {
      orderId,
      orderStatus,
      amount: cfOrder.order_amount,
      currency: cfOrder.order_currency,
      isPaid: orderStatus === 'PAID',
    };
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

    const refund = await this.paymentProviderRefund(
      payment.provider || 'CASHFREE',
      payment.provider_payment_id,
      params.amount,
    );

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
