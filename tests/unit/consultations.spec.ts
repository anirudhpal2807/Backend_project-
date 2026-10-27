import { ConsultationsService } from '../../src/modules/consultations/consultations.service';
import { DatabaseService } from '../../src/infra/db/database.service';
import { UnitOfWork } from '../../src/infra/db/unit-of-work';
import { CryptoService } from '../../src/infra/crypto/crypto.service';
import { OutboxService } from '../../src/infra/queue/outbox.service';
import { MockVideoProvider } from '../../src/modules/consultations/providers/mock-video-provider';
import { AppLoggerService } from '../../src/common/logger/app-logger.service';
import { AppException } from '../../src/common/errors/app-exception';
import { ErrorCode } from '../../src/common/errors/error-codes';
import { DatabaseTransaction } from '../../src/infra/db/database.types';

describe('ConsultationsService', () => {
  let consultationsService: ConsultationsService;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockUow: jest.Mocked<UnitOfWork>;
  let mockCrypto: jest.Mocked<CryptoService>;
  let mockOutbox: jest.Mocked<OutboxService>;
  let mockVideo: jest.Mocked<MockVideoProvider>;
  let mockLogger: jest.Mocked<AppLoggerService>;

  beforeEach(() => {
    mockDbService = {
      db: {} as unknown,
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
        encryptedData: 'enc-data',
        iv: 'iv-hex',
        tag: 'tag-hex',
        encryptedDek: 'dek-hex',
        keyVersion: 'v1',
      }),
      decrypt: jest.fn().mockResolvedValue('decrypted-clinical-notes'),
    } as unknown as jest.Mocked<CryptoService>;

    mockOutbox = {
      publishInTransaction: jest.fn().mockResolvedValue('outbox-1'),
    } as unknown as jest.Mocked<OutboxService>;

    mockVideo = {
      createSession: jest.fn().mockResolvedValue({
        sessionId: 'vid-123',
        roomName: 'room-abc',
        token: 'token-jwt',
        expiresAt: new Date(),
        provider: 'MOCK_DAILY',
      }),
      endSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MockVideoProvider>;

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    consultationsService = new ConsultationsService(
      mockDbService,
      mockUow,
      mockCrypto,
      mockOutbox,
      mockVideo,
      mockLogger,
    );
  });

  describe('startConsultation', () => {
    it('should reject if user is not a doctor', async () => {
      mockUow.withTransaction.mockImplementation(async cb => {
        const mockTrx = {
          selectFrom: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            executeTakeFirst: jest.fn().mockResolvedValue(null),
          }),
        };
        return cb(mockTrx as unknown as DatabaseTransaction);
      });

      await expect(consultationsService.startConsultation('c-1', 'not-a-doctor')).rejects.toThrow(
        AppException,
      );
    });

    it('should start consultation, transition to IN_PROGRESS, and create video session', async () => {
      mockUow.withTransaction.mockImplementation(async cb => {
        const mockDoctor = { id: 'doc-1' };
        const mockConsultation = {
          id: 'c-1',
          doctor_id: 'doc-1',
          patient_id: 'pat-1',
          status: 'CONFIRMED',
          slot_id: 's-1',
        };

        const mockTrx = {
          selectFrom: jest.fn().mockImplementation((table: string) => {
            if (table === 'doctors') {
              return {
                select: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                executeTakeFirst: jest.fn().mockResolvedValue(mockDoctor),
              };
            }
            return {
              selectAll: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              forUpdate: jest.fn().mockReturnThis(),
              executeTakeFirst: jest.fn().mockResolvedValue(mockConsultation),
            };
          }),
          updateTable: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            execute: jest.fn().mockResolvedValue([]),
          }),
        };

        return cb(mockTrx as unknown as DatabaseTransaction);
      });

      const result = await consultationsService.startConsultation('c-1', 'doc-user-1');

      expect(result.status).toBe('IN_PROGRESS');
      expect(result.video_session.roomName).toBe('room-abc');
      expect(mockVideo.createSession).toHaveBeenCalled();
    });
  });

  describe('updateClinicalNotes (Optimistic Locking & AES-256-GCM)', () => {
    it('should throw 409 Conflict if version does not match', async () => {
      mockUow.withTransaction.mockImplementation(async cb => {
        const mockDoctor = { id: 'doc-1' };
        const mockConsultation = {
          id: 'c-1',
          doctor_id: 'doc-1',
          status: 'IN_PROGRESS',
          version: 2,
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
          updateTable: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            executeTakeFirst: jest.fn().mockResolvedValue({ numUpdatedRows: BigInt(0) }), // optimistic lock failure
          }),
        };

        return cb(mockTrx as unknown as DatabaseTransaction);
      });

      await expect(
        consultationsService.updateClinicalNotes('c-1', 'doc-user-1', {
          notes: 'Patient showing recovery',
          version: 1, // stale version
        }),
      ).rejects.toThrow(AppException);

      try {
        await consultationsService.updateClinicalNotes('c-1', 'doc-user-1', {
          notes: 'Patient showing recovery',
          version: 1,
        });
      } catch (e) {
        const err = e as AppException;
        expect(err.getStatus()).toBe(409);
        expect(err.code).toBe(ErrorCode.CONFLICT);
      }
    });
  });
});
