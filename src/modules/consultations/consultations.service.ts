import { Injectable, HttpStatus, Optional } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { UnitOfWork } from '../../infra/db/unit-of-work';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { OutboxService } from '../../infra/queue/outbox.service';
import { MockVideoProvider } from './providers/mock-video-provider';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { UpdateClinicalNotesDto, CompleteConsultationDto } from './dto/consultation.dto';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ConsultationStateMachine } from '../bookings/domain/consultation-state-machine';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ConsultationsService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly cryptoService: CryptoService,
    private readonly outboxService: OutboxService,
    private readonly videoProvider: MockVideoProvider,
    private readonly logger: AppLoggerService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * Starts a consultation, transitions state to IN_PROGRESS, and provisions video session.
   */
  public async startConsultation(consultationId: string, doctorUserId: string) {
    return this.uow.withTransaction(async trx => {
      // Find doctor profile for this user
      const doctor = await trx
        .selectFrom('doctors')
        .select(['id'])
        .where('user_id', '=', doctorUserId)
        .executeTakeFirst();

      if (!doctor) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Doctor profile not found for authenticated user',
        );
      }

      const consultation = await trx
        .selectFrom('consultations')
        .selectAll()
        .where('id', '=', consultationId)
        .forUpdate()
        .executeTakeFirst();

      if (!consultation) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Consultation not found');
      }

      if (consultation.doctor_id !== doctor.id) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Only the assigned doctor can start this consultation',
        );
      }

      ConsultationStateMachine.assertCanTransition(consultation.status, 'IN_PROGRESS', 'DOCTOR');

      // Create video session
      const videoSession = await this.videoProvider.createSession({
        consultationId: consultation.id,
        doctorId: doctor.id,
        patientId: consultation.patient_id,
      });

      const now = new Date();
      await trx
        .updateTable('consultations')
        .set({
          status: 'IN_PROGRESS',
          video_room_id: videoSession.roomName,
          updated_at: now,
        })
        .where('id', '=', consultation.id)
        .execute();

      await this.outboxService.publishInTransaction(
        trx,
        'consultation.started',
        'consultation',
        consultation.id,
        {
          consultationId: consultation.id,
          doctorId: doctor.id,
          patientId: consultation.patient_id,
          videoRoom: videoSession.roomName,
        },
      );

      if (this.auditService) {
        await this.auditService.record(
          {
            actorId: doctorUserId,
            actorRole: 'DOCTOR',
            action: 'consultation.started',
            resourceType: 'consultation',
            resourceId: consultation.id,
            outcome: 'SUCCESS',
            metadata: {
              room_name: videoSession.roomName,
            },
          },
          trx,
        );
      }

      this.logger.log(`Consultation ${consultation.id} started by doctor ${doctor.id}`);

      return {
        consultation_id: consultation.id,
        status: 'IN_PROGRESS',
        video_session: videoSession,
      };
    });
  }

  /**
   * Updates clinical notes with AES-256-GCM envelope encryption and optimistic locking.
   */
  public async updateClinicalNotes(
    consultationId: string,
    doctorUserId: string,
    dto: UpdateClinicalNotesDto,
  ) {
    return this.uow.withTransaction(async trx => {
      const doctor = await trx
        .selectFrom('doctors')
        .select(['id'])
        .where('user_id', '=', doctorUserId)
        .executeTakeFirst();

      if (!doctor) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Doctor profile not found for authenticated user',
        );
      }

      const consultation = await trx
        .selectFrom('consultations')
        .selectAll()
        .where('id', '=', consultationId)
        .executeTakeFirst();

      if (!consultation) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Consultation not found');
      }

      if (consultation.doctor_id !== doctor.id) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Only the assigned doctor can update clinical notes',
        );
      }

      if (!['IN_PROGRESS', 'COMPLETED'].includes(consultation.status)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.ILLEGAL_STATE_TRANSITION,
          `Cannot update clinical notes when consultation is in status '${consultation.status}'`,
        );
      }

      // Encrypt notes using AES-256-GCM envelope encryption
      const encryptedNotes = await this.cryptoService.encrypt(dto.notes);
      const encryptedPayloadString = JSON.stringify(encryptedNotes);

      const now = new Date();

      // Optimistic locking check: update where version = dto.version
      const result = await trx
        .updateTable('consultations')
        .set({
          clinical_notes_encrypted: encryptedPayloadString,
          version: consultation.version + 1,
          updated_at: now,
        })
        .where('id', '=', consultationId)
        .where('version', '=', dto.version)
        .executeTakeFirst();

      if (result.numUpdatedRows === BigInt(0)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'Optimistic concurrency failure: clinical notes were modified by another request. Please reload and retry.',
        );
      }

      await this.outboxService.publishInTransaction(
        trx,
        'consultation.notes_updated',
        'consultation',
        consultationId,
        {
          consultationId,
          version: consultation.version + 1,
        },
      );

      if (this.auditService) {
        await this.auditService.record(
          {
            actorId: doctorUserId,
            actorRole: 'DOCTOR',
            action: 'consultation.notes_updated',
            resourceType: 'consultation',
            resourceId: consultationId,
            outcome: 'SUCCESS',
            metadata: {
              version: consultation.version + 1,
            },
          },
          trx,
        );
      }

      return {
        consultation_id: consultationId,
        version: consultation.version + 1,
        updated_at: now,
      };
    });
  }

  /**
   * Completes consultation and terminates video session.
   */
  public async completeConsultation(
    consultationId: string,
    doctorUserId: string,
    _dto?: CompleteConsultationDto,
  ) {
    void _dto;
    return this.uow.withTransaction(async trx => {
      const doctor = await trx
        .selectFrom('doctors')
        .select(['id'])
        .where('user_id', '=', doctorUserId)
        .executeTakeFirst();

      if (!doctor) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Doctor profile not found for authenticated user',
        );
      }

      const consultation = await trx
        .selectFrom('consultations')
        .selectAll()
        .where('id', '=', consultationId)
        .forUpdate()
        .executeTakeFirst();

      if (!consultation) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Consultation not found');
      }

      if (consultation.doctor_id !== doctor.id) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Only the assigned doctor can complete this consultation',
        );
      }

      ConsultationStateMachine.assertCanTransition(consultation.status, 'COMPLETED', 'DOCTOR');

      if (consultation.video_room_id) {
        await this.videoProvider.endSession(consultation.video_room_id);
      }

      const now = new Date();
      await trx
        .updateTable('consultations')
        .set({
          status: 'COMPLETED',
          updated_at: now,
        })
        .where('id', '=', consultation.id)
        .execute();

      await this.outboxService.publishInTransaction(
        trx,
        'consultation.completed',
        'consultation',
        consultation.id,
        {
          consultationId: consultation.id,
          doctorId: doctor.id,
          patientId: consultation.patient_id,
        },
      );

      if (this.auditService) {
        await this.auditService.record(
          {
            actorId: doctorUserId,
            actorRole: 'DOCTOR',
            action: 'consultation.completed',
            resourceType: 'consultation',
            resourceId: consultation.id,
            outcome: 'SUCCESS',
            metadata: {
              patient_id: consultation.patient_id,
            },
          },
          trx,
        );
      }

      this.logger.log(`Consultation ${consultation.id} marked COMPLETED by doctor ${doctor.id}`);

      return {
        consultation_id: consultation.id,
        status: 'COMPLETED',
        completed_at: now,
      };
    });
  }

  /**
   * Retrieves consultation details with strict role-based access.
   * Clinical notes decrypted only for patient or assigned doctor.
   */
  public async getConsultation(
    consultationId: string,
    actorId: string,
    actorRole: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'AUDITOR',
  ) {
    const consultation = await this.dbService.db
      .selectFrom('consultations')
      .selectAll()
      .where('id', '=', consultationId)
      .executeTakeFirst();

    if (!consultation) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Consultation not found');
    }

    // Role ownership check
    if (actorRole === 'PATIENT' && consultation.patient_id !== actorId) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Access denied to this consultation',
      );
    }

    if (actorRole === 'DOCTOR') {
      const doctor = await this.dbService.db
        .selectFrom('doctors')
        .select(['id'])
        .where('user_id', '=', actorId)
        .executeTakeFirst();

      if (!doctor || doctor.id !== consultation.doctor_id) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Access denied to this consultation',
        );
      }
    }

    // Decrypt clinical notes if patient or doctor
    let decryptedNotes: string | null = null;
    if (
      consultation.clinical_notes_encrypted &&
      (actorRole === 'PATIENT' || actorRole === 'DOCTOR')
    ) {
      try {
        const encryptedEnvelope = JSON.parse(consultation.clinical_notes_encrypted);
        decryptedNotes = await this.cryptoService.decrypt(encryptedEnvelope);
      } catch (err) {
        this.logger.error('Failed to decrypt clinical notes', (err as Error).stack);
      }
    }

    return {
      id: consultation.id,
      patient_id: consultation.patient_id,
      doctor_id: consultation.doctor_id,
      slot_id: consultation.slot_id,
      status: consultation.status,
      scheduled_at: consultation.scheduled_at,
      clinical_notes: decryptedNotes,
      video_room_id: consultation.video_room_id,
      version: consultation.version,
      created_at: consultation.created_at,
      updated_at: consultation.updated_at,
    };
  }
}
