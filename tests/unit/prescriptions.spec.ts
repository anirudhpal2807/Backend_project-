import { PrescriptionsService } from '../../src/modules/prescriptions/prescriptions.service';
import { DatabaseService } from '../../src/infra/db/database.service';
import { UnitOfWork } from '../../src/infra/db/unit-of-work';
import { CryptoService } from '../../src/infra/crypto/crypto.service';
import { OutboxService } from '../../src/infra/queue/outbox.service';
import { IIdGenerator } from '../../src/common/id/id-generator.interface';
import { AppLoggerService } from '../../src/common/logger/app-logger.service';
import { AppException } from '../../src/common/errors/app-exception';
import { DatabaseTransaction } from '../../src/infra/db/database.types';

describe('PrescriptionsService', () => {
  let prescriptionsService: PrescriptionsService;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockUow: jest.Mocked<UnitOfWork>;
  let mockCrypto: jest.Mocked<CryptoService>;
  let mockOutbox: jest.Mocked<OutboxService>;
  let mockIdGenerator: jest.Mocked<IIdGenerator>;
  let mockLogger: jest.Mocked<AppLoggerService>;

  let mockDbInstance: unknown = {};

  beforeEach(() => {
    mockDbInstance = {};
    mockDbService = {
      get db() {
        return mockDbInstance;
      },
    } as unknown as jest.Mocked<DatabaseService>;

    mockUow = {
      withTransaction: jest
        .fn()
        .mockImplementation(async (callback: (trx: DatabaseTransaction) => Promise<unknown>) => {
          return callback({} as DatabaseTransaction);
        }),
    } as unknown as jest.Mocked<UnitOfWork>;

    mockCrypto = {
      encrypt: jest.fn().mockResolvedValue({
        encryptedData: 'enc-items',
        iv: 'iv-hex',
        tag: 'tag-hex',
        encryptedDek: 'dek-hex',
        keyVersion: 'v1',
      }),
      decrypt: jest.fn().mockImplementation(async envelope => {
        if (envelope.encryptedData === 'enc-items') {
          return JSON.stringify([
            {
              medicine_name: 'Ashwagandha',
              dosage: '500mg',
              frequency: 'Twice daily',
              duration_days: 30,
            },
          ]);
        }
        return 'Take with warm milk';
      }),
    } as unknown as jest.Mocked<CryptoService>;

    mockOutbox = {
      publishInTransaction: jest.fn().mockResolvedValue('outbox-1'),
    } as unknown as jest.Mocked<OutboxService>;

    mockIdGenerator = {
      generate: jest.fn().mockReturnValue('rx-v7-id'),
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    prescriptionsService = new PrescriptionsService(
      mockDbService,
      mockUow,
      mockCrypto,
      mockOutbox,
      mockIdGenerator,
      mockLogger,
    );
  });

  describe('createPrescription', () => {
    it('should create version 1 prescription with encrypted payload and outbox event', async () => {
      mockUow.withTransaction.mockImplementation(async cb => {
        const mockDoctor = { id: 'doc-1' };
        const mockConsultation = {
          id: 'c-1',
          doctor_id: 'doc-1',
          patient_id: 'pat-1',
          status: 'IN_PROGRESS',
        };

        const mockTrx = {
          selectFrom: jest.fn().mockImplementation((table: string) => ({
            select: jest.fn().mockReturnThis(),
            selectAll: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            executeTakeFirst: jest
              .fn()
              .mockResolvedValue(table === 'doctors' ? mockDoctor : mockConsultation),
          })),
          insertInto: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue([]),
          }),
        };

        return cb(mockTrx as unknown as DatabaseTransaction);
      });

      const result = await prescriptionsService.createPrescription('doc-user-1', {
        consultation_id: 'c-1',
        items: [
          {
            medicine_name: 'Ashwagandha',
            dosage: '500mg',
            frequency: 'Twice daily',
            duration_days: 30,
          },
        ],
        instructions: 'Take after meals',
      });

      expect(result.id).toBe('rx-v7-id');
      expect(result.version).toBe(1);
      expect(mockCrypto.encrypt).toHaveBeenCalled();
      expect(mockOutbox.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'prescription.created',
        'prescription',
        'rx-v7-id',
        expect.objectContaining({ version: 1 }),
      );
    });

    it('should reject if consultation is not in progress or completed', async () => {
      mockUow.withTransaction.mockImplementation(async cb => {
        const mockDoctor = { id: 'doc-1' };
        const mockConsultation = {
          id: 'c-1',
          doctor_id: 'doc-1',
          status: 'CONFIRMED', // not yet started
        };

        const mockTrx = {
          selectFrom: jest.fn().mockImplementation((table: string) => ({
            select: jest.fn().mockReturnThis(),
            selectAll: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            executeTakeFirst: jest
              .fn()
              .mockResolvedValue(table === 'doctors' ? mockDoctor : mockConsultation),
          })),
        };

        return cb(mockTrx as unknown as DatabaseTransaction);
      });

      await expect(
        prescriptionsService.createPrescription('doc-user-1', {
          consultation_id: 'c-1',
          items: [
            {
              medicine_name: 'Ashwagandha',
              dosage: '500mg',
              frequency: 'Twice daily',
              duration_days: 30,
            },
          ],
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('getPrescription (Audited Read & Admin Masking - T-073)', () => {
    const mockPrescriptionRecord = {
      id: 'rx-1',
      consultation_id: 'c-1',
      doctor_id: 'doc-1',
      patient_id: 'pat-1',
      version: 1,
      items_encrypted: JSON.stringify({ encryptedData: 'enc-items' }),
      instructions_encrypted: JSON.stringify({ encryptedData: 'enc-instructions' }),
      pdf_url: 'https://storage.amrutam.global/rx.pdf',
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('should return decrypted clinical items to the patient', async () => {
      mockDbInstance = {
        selectFrom: jest.fn().mockReturnValue({
          selectAll: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          executeTakeFirst: jest.fn().mockResolvedValue(mockPrescriptionRecord),
        }),
      };

      const result = await prescriptionsService.getPrescription('rx-1', 'pat-1', 'PATIENT');

      expect(result.items).toHaveLength(1);
      expect(result.items?.[0]?.medicine_name).toBe('Ashwagandha');
      expect(result.instructions).toBe('Take with warm milk');
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Prescription rx-1 read by actor pat-1'),
      );
    });

    it('should mask clinical items and instructions when accessed by ADMIN (metadata only)', async () => {
      mockDbInstance = {
        selectFrom: jest.fn().mockReturnValue({
          selectAll: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          executeTakeFirst: jest.fn().mockResolvedValue(mockPrescriptionRecord),
        }),
      };

      const result = await prescriptionsService.getPrescription('rx-1', 'admin-1', 'ADMIN');

      // CRITICAL SECURITY ASSERTION (T-073): Admin sees metadata ONLY
      expect(result.id).toBe('rx-1');
      expect(result.items).toBeNull();
      expect(result.instructions).toBeNull();
      expect(result.version).toBe(1);
    });
  });
});
