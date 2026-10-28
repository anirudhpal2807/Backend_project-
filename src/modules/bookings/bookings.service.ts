import { Injectable, HttpStatus } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { UnitOfWork } from '../../infra/db/unit-of-work';
import { UuidV7IdGenerator } from '../../common/id/uuidv7-id-generator';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { OutboxService } from '../../infra/queue/outbox.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateBookingHoldDto, CancelBookingDto } from './dto/booking.dto';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ConsultationStateMachine } from './domain/consultation-state-machine';
import { CancellationPolicyEngine } from './domain/cancellation-policy';
import { sql } from 'kysely';

@Injectable()
export class BookingsService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly idGenerator: UuidV7IdGenerator,
    private readonly logger: AppLoggerService,
    private readonly outboxService: OutboxService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * Holds an open slot for 10 minutes and creates a consultation in PENDING_PAYMENT status.
   * Enforces zero double-booking and patient overlap prevention.
   */
  public async holdSlot(patientId: string, dto: CreateBookingHoldDto) {
    return this.uow.withTransaction(async trx => {
      // 1. Fetch and lock the target slot
      const slot = await trx
        .selectFrom('availability_slots')
        .selectAll()
        .where('id', '=', dto.slot_id)
        .forUpdate()
        .executeTakeFirst();

      if (!slot) {
        throw new AppException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Availability slot not found',
        );
      }

      const now = new Date();

      // Check slot availability
      const isSlotCurrentlyHeld =
        slot.status === 'HELD' &&
        slot.held_until !== null &&
        new Date(slot.held_until).getTime() > now.getTime();

      if (slot.status === 'BOOKED' || isSlotCurrentlyHeld || slot.status === 'BLOCKED') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.SLOT_NOT_AVAILABLE,
          'Selected slot is no longer available',
        );
      }

      // 2. Verify Doctor is active and VERIFIED
      const doctor = await trx
        .selectFrom('doctors')
        .select(['id', 'status', 'consultation_fee'])
        .where('id', '=', slot.doctor_id)
        .executeTakeFirst();

      if (!doctor || doctor.status !== 'VERIFIED') {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.BAD_REQUEST,
          'Doctor is not available for bookings',
        );
      }

      // 3. Patient Overlap Check (T-069): Ensure patient has no overlapping active consultations
      const overlappingConsultation = await trx
        .selectFrom('consultations as c')
        .innerJoin('availability_slots as s', 's.id', 'c.slot_id')
        .select(['c.id', 's.start_at', 's.end_at'])
        .where('c.patient_id', '=', patientId)
        .where('c.status', 'in', ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'])
        .where(
          sql<boolean>`tstzrange(s.start_at, s.end_at) && tstzrange(${slot.start_at}, ${slot.end_at})`,
        )
        .executeTakeFirst();

      if (overlappingConsultation) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.SLOT_OVERLAP,
          'You already have an active consultation scheduled during this time window',
        );
      }

      // 4. Update slot status to HELD with 10-minute hold window
      const holdExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);

      await trx
        .updateTable('availability_slots')
        .set({
          status: 'HELD',
          held_until: holdExpiresAt,
          updated_at: now,
        })
        .where('id', '=', slot.id)
        .execute();

      // 5. Insert consultation in PENDING_PAYMENT
      const consultationId = this.idGenerator.generate();
      await trx
        .insertInto('consultations')
        .values({
          id: consultationId,
          patient_id: patientId,
          doctor_id: slot.doctor_id,
          slot_id: slot.id,
          status: 'PENDING_PAYMENT',
          scheduled_at: slot.start_at,
          created_at: now,
          updated_at: now,
        })
        .execute();

      // 6. Transactional Outbox Event
      await this.outboxService.publishInTransaction(
        trx,
        'booking.held',
        'consultation',
        consultationId,
        {
          consultationId,
          slotId: slot.id,
          patientId,
          doctorId: slot.doctor_id,
          holdExpiresAt: holdExpiresAt.toISOString(),
        },
      );

      this.logger.log(
        `Slot ${slot.id} held for consultation ${consultationId} until ${holdExpiresAt.toISOString()}`,
      );

      return {
        consultation_id: consultationId,
        slot_id: slot.id,
        doctor_id: slot.doctor_id,
        fee_amount: doctor.consultation_fee,
        fee_currency: 'INR',
        status: 'PENDING_PAYMENT',
        hold_expires_at: holdExpiresAt,
      };
    });
  }

  /**
   * Cancels a consultation and slot with refund evaluation per policy engine.
   */
  public async cancelBooking(
    consultationId: string,
    actorId: string,
    actorRole: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'SYSTEM',
    dto: CancelBookingDto,
  ) {
    return this.uow.withTransaction(async trx => {
      const consultation = await trx
        .selectFrom('consultations')
        .selectAll()
        .where('id', '=', consultationId)
        .forUpdate()
        .executeTakeFirst();

      if (!consultation) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Consultation not found');
      }

      // Ownership authorization
      if (actorRole === 'PATIENT' && consultation.patient_id !== actorId) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Access denied to cancel this consultation',
        );
      }

      if (actorRole === 'DOCTOR' && consultation.doctor_id !== actorId) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Access denied to cancel this consultation',
        );
      }

      // Assert state transition validity
      ConsultationStateMachine.assertCanTransition(consultation.status, 'CANCELLED', actorRole);

      const slot = await trx
        .selectFrom('availability_slots')
        .selectAll()
        .where('id', '=', consultation.slot_id)
        .forUpdate()
        .executeTakeFirst();

      const doctor = await trx
        .selectFrom('doctors')
        .select(['consultation_fee'])
        .where('id', '=', consultation.doctor_id)
        .executeTakeFirst();

      const now = new Date();
      const appointmentStart = slot?.start_at ? new Date(slot.start_at) : now;
      const feeAmount = doctor?.consultation_fee ?? 1000;

      // Evaluate refund policy
      const policyResult = CancellationPolicyEngine.evaluate({
        appointmentStart,
        cancellationTime: now,
        actorRole,
        feeAmount,
      });

      if (!policyResult.allowed) {
        throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST, policyResult.reason);
      }

      // Update consultation
      await trx
        .updateTable('consultations')
        .set({
          status: 'CANCELLED',
          updated_at: now,
        })
        .where('id', '=', consultation.id)
        .execute();

      // Update slot: if hold, release to OPEN; if confirmed, set CANCELLED
      if (slot) {
        const nextSlotStatus = consultation.status === 'PENDING_PAYMENT' ? 'OPEN' : 'CANCELLED';
        await trx
          .updateTable('availability_slots')
          .set({
            status: nextSlotStatus,
            held_until: null,
            updated_at: now,
          })
          .where('id', '=', slot.id)
          .execute();
      }

      // Process refund if applicable
      let refundResult = null;
      if (policyResult.refundAmount > 0) {
        refundResult = await this.paymentsService.refundPayment({
          consultationId: consultation.id,
          amount: policyResult.refundAmount,
          reason: dto.reason,
        });
      }

      // Outbox event
      await this.outboxService.publishInTransaction(
        trx,
        'consultation.cancelled',
        'consultation',
        consultation.id,
        {
          consultationId: consultation.id,
          slotId: consultation.slot_id,
          cancelledBy: actorId,
          actorRole,
          reason: dto.reason,
          refundAmount: policyResult.refundAmount,
          cancellationFee: policyResult.cancellationFee,
        },
      );

      this.logger.log(
        `Consultation ${consultation.id} cancelled by ${actorId}. Policy: ${policyResult.reason}`,
      );

      return {
        consultation_id: consultation.id,
        status: 'CANCELLED',
        policy: policyResult,
        refund: refundResult,
      };
    });
  }

  /**
   * Reaps expired holds and transitions stale consultations to EXPIRED.
   */
  public async reapExpiredHolds(): Promise<number> {
    const now = new Date();

    const expiredSlots = await this.dbService.db
      .selectFrom('availability_slots')
      .selectAll()
      .where('status', '=', 'HELD')
      .where('held_until', '<', now)
      .execute();

    let reapedCount = 0;

    for (const slot of expiredSlots) {
      await this.uow.withTransaction(async trx => {
        // Reset slot to OPEN
        await trx
          .updateTable('availability_slots')
          .set({
            status: 'OPEN',
            held_until: null,
            updated_at: now,
          })
          .where('id', '=', slot.id)
          .where('status', '=', 'HELD')
          .execute();

        // Expire any pending consultation for this slot
        const pendingConsultation = await trx
          .selectFrom('consultations')
          .selectAll()
          .where('slot_id', '=', slot.id)
          .where('status', '=', 'PENDING_PAYMENT')
          .executeTakeFirst();

        if (pendingConsultation) {
          await trx
            .updateTable('consultations')
            .set({
              status: 'EXPIRED',
              updated_at: now,
            })
            .where('id', '=', pendingConsultation.id)
            .execute();

          await this.outboxService.publishInTransaction(
            trx,
            'booking.hold_expired',
            'consultation',
            pendingConsultation.id,
            {
              consultationId: pendingConsultation.id,
              slotId: slot.id,
            },
          );
        }

        reapedCount++;
      });
    }

    if (reapedCount > 0) {
      this.logger.log(`Reaped ${reapedCount} expired slot holds`);
    }

    return reapedCount;
  }
}
