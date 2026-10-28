import { Injectable, HttpStatus, Optional } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { UnitOfWork } from '../../infra/db/unit-of-work';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { OutboxService } from '../../infra/queue/outbox.service';
import { IIdGenerator } from '../../common/id/id-generator.interface';
import { AppLoggerService } from '../../common/logger/app-logger.service';
import { AuditService } from '../audit/audit.service';
import {
  CreatePrescriptionDto,
  AmendPrescriptionDto,
  PrescriptionItem,
} from './dto/prescription.dto';
import { AppException } from '../../common/errors/app-exception';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly cryptoService: CryptoService,
    private readonly outboxService: OutboxService,
    private readonly idGenerator: IIdGenerator,
    private readonly logger: AppLoggerService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /**
   * Creates a new prescription (version 1) with field-level AES-256-GCM encryption.
   */
  public async createPrescription(doctorUserId: string, dto: CreatePrescriptionDto) {
    return this.uow.withTransaction(async trx => {
      // Find doctor profile
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

      // Check consultation state
      const consultation = await trx
        .selectFrom('consultations')
        .selectAll()
        .where('id', '=', dto.consultation_id)
        .executeTakeFirst();

      if (!consultation) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Consultation not found');
      }

      if (consultation.doctor_id !== doctor.id) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Only the assigned doctor can issue a prescription for this consultation',
        );
      }

      if (!['IN_PROGRESS', 'COMPLETED'].includes(consultation.status)) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.ILLEGAL_STATE_TRANSITION,
          `Cannot prescribe medication when consultation is in '${consultation.status}' state`,
        );
      }

      // Encrypt items and instructions using AES-256-GCM envelope encryption
      const encryptedItems = await this.cryptoService.encrypt(JSON.stringify(dto.items));
      const encryptedInstructions = dto.instructions
        ? await this.cryptoService.encrypt(dto.instructions)
        : null;

      const prescriptionId = this.idGenerator.generate();
      const now = new Date();

      await trx
        .insertInto('prescriptions')
        .values({
          id: prescriptionId,
          consultation_id: consultation.id,
          doctor_id: doctor.id,
          patient_id: consultation.patient_id,
          version: 1,
          items_encrypted: JSON.stringify(encryptedItems),
          instructions_encrypted: encryptedInstructions
            ? JSON.stringify(encryptedInstructions)
            : null,
          key_version: 'v1',
          pdf_url: null,
          created_at: now,
          updated_at: now,
        })
        .execute();

      // Publish outbox event for async PDF generation worker
      await this.outboxService.publishInTransaction(
        trx,
        'prescription.created',
        'prescription',
        prescriptionId,
        {
          prescriptionId,
          consultationId: consultation.id,
          doctorId: doctor.id,
          patientId: consultation.patient_id,
          version: 1,
        },
      );

      if (this.auditService) {
        await this.auditService.record(
          {
            actorId: doctorUserId,
            actorRole: 'DOCTOR',
            action: 'prescription.created',
            resourceType: 'prescription',
            resourceId: prescriptionId,
            outcome: 'SUCCESS',
            metadata: {
              consultation_id: consultation.id,
              version: 1,
              item_count: dto.items.length,
            },
          },
          trx,
        );
      }

      this.logger.log(`Prescription ${prescriptionId} (v1) created by doctor ${doctor.id}`);

      return {
        id: prescriptionId,
        consultation_id: consultation.id,
        version: 1,
        created_at: now,
      };
    });
  }

  /**
   * Amends a prescription: creates a new version row while retaining full historical audit trail.
   */
  public async amendPrescription(
    prescriptionId: string,
    doctorUserId: string,
    dto: AmendPrescriptionDto,
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
          'Doctor profile not found',
        );
      }

      const existing = await trx
        .selectFrom('prescriptions')
        .selectAll()
        .where('id', '=', prescriptionId)
        .executeTakeFirst();

      if (!existing) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Prescription not found');
      }

      if (existing.doctor_id !== doctor.id) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Only the issuing doctor can amend this prescription',
        );
      }

      // Encrypt new payload
      const encryptedItems = await this.cryptoService.encrypt(JSON.stringify(dto.items));
      const encryptedInstructions = dto.instructions
        ? await this.cryptoService.encrypt(dto.instructions)
        : null;

      const newPrescriptionId = this.idGenerator.generate();
      const newVersion = existing.version + 1;
      const now = new Date();

      await trx
        .insertInto('prescriptions')
        .values({
          id: newPrescriptionId,
          consultation_id: existing.consultation_id,
          doctor_id: doctor.id,
          patient_id: existing.patient_id,
          version: newVersion,
          items_encrypted: JSON.stringify(encryptedItems),
          instructions_encrypted: encryptedInstructions
            ? JSON.stringify(encryptedInstructions)
            : null,
          key_version: 'v1',
          pdf_url: null,
          created_at: now,
          updated_at: now,
        })
        .execute();

      await this.outboxService.publishInTransaction(
        trx,
        'prescription.amended',
        'prescription',
        newPrescriptionId,
        {
          previousId: existing.id,
          newId: newPrescriptionId,
          version: newVersion,
          reason: dto.reason,
        },
      );

      if (this.auditService) {
        await this.auditService.record(
          {
            actorId: doctorUserId,
            actorRole: 'DOCTOR',
            action: 'prescription.amended',
            resourceType: 'prescription',
            resourceId: newPrescriptionId,
            outcome: 'SUCCESS',
            metadata: {
              previous_id: existing.id,
              version: newVersion,
              reason: dto.reason,
            },
          },
          trx,
        );
      }

      this.logger.log(`Prescription amended: created v${newVersion} (${newPrescriptionId})`);

      return {
        id: newPrescriptionId,
        version: newVersion,
        created_at: now,
        reason: dto.reason,
      };
    });
  }

  /**
   * Retrieves a prescription.
   * Every read is audited.
   * Admins see metadata only (clinical data hidden).
   * Patient and issuing doctor receive full decrypted clinical items.
   */
  public async getPrescription(
    prescriptionId: string,
    actorId: string,
    actorRole: 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'AUDITOR',
  ) {
    const prescription = await this.dbService.db
      .selectFrom('prescriptions')
      .selectAll()
      .where('id', '=', prescriptionId)
      .executeTakeFirst();

    if (!prescription) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Prescription not found');
    }

    // Role-based read authorization
    if (actorRole === 'PATIENT' && prescription.patient_id !== actorId) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'Access denied to view this prescription',
      );
    }

    if (actorRole === 'DOCTOR') {
      const doctor = await this.dbService.db
        .selectFrom('doctors')
        .select(['id'])
        .where('user_id', '=', actorId)
        .executeTakeFirst();

      if (!doctor || doctor.id !== prescription.doctor_id) {
        throw new AppException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          'Access denied to view this prescription',
        );
      }
    }

    // Record audit trail of prescription read (T-073)
    if (this.auditService) {
      await this.auditService.record({
        actorId,
        actorRole,
        action: 'prescription.read',
        resourceType: 'prescription',
        resourceId: prescription.id,
        outcome: 'SUCCESS',
        metadata: {
          version: prescription.version,
          is_admin_or_auditor: actorRole === 'ADMIN' || actorRole === 'AUDITOR',
        },
      });
    }

    this.logger.log(
      `Prescription ${prescription.id} read by actor ${actorId} (role: ${actorRole})`,
    );

    // If ADMIN or AUDITOR: return metadata only (items/instructions are hidden)
    if (actorRole === 'ADMIN' || actorRole === 'AUDITOR') {
      return {
        id: prescription.id,
        consultation_id: prescription.consultation_id,
        doctor_id: prescription.doctor_id,
        patient_id: prescription.patient_id,
        version: prescription.version,
        pdf_url: prescription.pdf_url,
        items: null, // Hidden from admin
        instructions: null, // Hidden from admin
        created_at: prescription.created_at,
        updated_at: prescription.updated_at,
      };
    }

    // Decrypt items and instructions for patient or issuing doctor
    let items: PrescriptionItem[] = [];
    let instructions: string | null = null;

    try {
      const encryptedItemsEnvelope = JSON.parse(prescription.items_encrypted);
      const decryptedItemsJson = await this.cryptoService.decrypt(encryptedItemsEnvelope);
      items = JSON.parse(decryptedItemsJson);

      if (prescription.instructions_encrypted) {
        const encryptedInstEnvelope = JSON.parse(prescription.instructions_encrypted);
        instructions = await this.cryptoService.decrypt(encryptedInstEnvelope);
      }
    } catch (err) {
      this.logger.error('Failed to decrypt prescription payload', (err as Error).stack);
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.DECRYPTION_FAILED,
        'Failed to decrypt prescription items',
      );
    }

    return {
      id: prescription.id,
      consultation_id: prescription.consultation_id,
      doctor_id: prescription.doctor_id,
      patient_id: prescription.patient_id,
      version: prescription.version,
      items,
      instructions,
      pdf_url: prescription.pdf_url,
      created_at: prescription.created_at,
      updated_at: prescription.updated_at,
    };
  }

  /**
   * PDF generation simulation worker method (T-074).
   */
  public async generatePrescriptionPdf(prescriptionId: string): Promise<string> {
    const pdfUrl = `https://storage.amrutam.global/prescriptions/${prescriptionId}.pdf?token=exp_${Date.now() + 86400000}`;

    await this.dbService.db
      .updateTable('prescriptions')
      .set({
        pdf_url: pdfUrl,
        updated_at: new Date(),
      })
      .where('id', '=', prescriptionId)
      .execute();

    return pdfUrl;
  }
}
