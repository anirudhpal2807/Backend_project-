import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { DatabaseService } from '../../src/infra/db/database.service';
import { UnitOfWork } from '../../src/infra/db/unit-of-work';
import { IIdGenerator } from '../../src/common/id/id-generator.interface';
import { AppLoggerService } from '../../src/common/logger/app-logger.service';
import { OutboxService } from '../../src/infra/queue/outbox.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { AppException } from '../../src/common/errors/app-exception';
import { ErrorCode } from '../../src/common/errors/error-codes';
import { DatabaseTransaction } from '../../src/infra/db/database.types';

describe('BookingsService', () => {
  let bookingsService: BookingsService;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockUow: jest.Mocked<UnitOfWork>;
  let mockIdGenerator: jest.Mocked<IIdGenerator>;
  let mockLogger: jest.Mocked<AppLoggerService>;
  let mockOutbox: jest.Mocked<OutboxService>;
  let mockPayments: jest.Mocked<PaymentsService>;

  beforeEach(() => {
    mockDbService = {
      db: {} as unknown,
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      ping: jest.fn(),
    } as unknown as jest.Mocked<DatabaseService>;

    mockUow = {
      withTransaction: jest.fn().mockImplementation(async callback => {
        return callback({} as DatabaseTransaction);
      }),
      withRetry: jest.fn(),
    } as unknown as jest.Mocked<UnitOfWork>;

    mockIdGenerator = {
      generate: jest.fn().mockReturnValue('mock-id-v7'),
    };

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      fatal: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    mockOutbox = {
      publishInTransaction: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
      pollAndDispatch: jest.fn(),
    } as unknown as jest.Mocked<OutboxService>;

    mockPayments = {
      createPaymentIntent: jest.fn(),
      handleWebhook: jest.fn(),
      refundPayment: jest.fn(),
    } as unknown as jest.Mocked<PaymentsService>;

    bookingsService = new BookingsService(
      mockDbService,
      mockUow,
      mockIdGenerator,
      mockLogger,
      mockOutbox,
      mockPayments,
    );
  });

  describe('holdSlot', () => {
    it('should throw 404 if slot does not exist', async () => {
      mockUow.withTransaction.mockImplementation(
        async (cb: (trx: DatabaseTransaction) => Promise<unknown>) => {
          const mockTrx = {
            selectFrom: jest.fn().mockReturnThis(),
            selectAll: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            forUpdate: jest.fn().mockReturnThis(),
            executeTakeFirst: jest.fn().mockResolvedValue(null),
          };
          return cb(mockTrx as unknown as DatabaseTransaction);
        },
      );

      await expect(bookingsService.holdSlot('patient-1', { slot_id: 'slot-1' })).rejects.toThrow(
        AppException,
      );

      try {
        await bookingsService.holdSlot('patient-1', { slot_id: 'slot-1' });
      } catch (e) {
        const err = e as AppException;
        expect(err.getStatus()).toBe(404);
        expect(err.code).toBe(ErrorCode.NOT_FOUND);
      }
    });

    it('should throw 409 if slot is already BOOKED', async () => {
      mockUow.withTransaction.mockImplementation(
        async (cb: (trx: DatabaseTransaction) => Promise<unknown>) => {
          const mockTrx = {
            selectFrom: jest.fn().mockReturnThis(),
            selectAll: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            forUpdate: jest.fn().mockReturnThis(),
            executeTakeFirst: jest.fn().mockResolvedValue({
              id: 'slot-1',
              status: 'BOOKED',
              start_at: new Date(),
              end_at: new Date(),
            }),
          };
          return cb(mockTrx as unknown as DatabaseTransaction);
        },
      );

      await expect(bookingsService.holdSlot('patient-1', { slot_id: 'slot-1' })).rejects.toThrow(
        AppException,
      );

      try {
        await bookingsService.holdSlot('patient-1', { slot_id: 'slot-1' });
      } catch (e) {
        const err = e as AppException;
        expect(err.getStatus()).toBe(409);
        expect(err.code).toBe(ErrorCode.SLOT_NOT_AVAILABLE);
      }
    });

    it('should successfully hold an OPEN slot and write outbox event', async () => {
      mockUow.withTransaction.mockImplementation(
        async (cb: (trx: DatabaseTransaction) => Promise<unknown>) => {
          const mockSlot = {
            id: 'slot-1',
            doctor_id: 'doc-1',
            status: 'OPEN',
            start_at: new Date(Date.now() + 86400000),
            end_at: new Date(Date.now() + 86400000 + 1800000),
            held_until: null,
          };
          const mockDoctor = {
            id: 'doc-1',
            status: 'VERIFIED',
            consultation_fee: 1000,
          };

          const mockTrx = {
            selectFrom: jest.fn().mockImplementation((table: string) => {
              if (table === 'availability_slots') {
                return {
                  selectAll: jest.fn().mockReturnThis(),
                  where: jest.fn().mockReturnThis(),
                  forUpdate: jest.fn().mockReturnThis(),
                  executeTakeFirst: jest.fn().mockResolvedValue(mockSlot),
                };
              }
              if (table === 'doctors') {
                return {
                  select: jest.fn().mockReturnThis(),
                  where: jest.fn().mockReturnThis(),
                  executeTakeFirst: jest.fn().mockResolvedValue(mockDoctor),
                };
              }
              if (table === 'consultations as c') {
                return {
                  innerJoin: jest.fn().mockReturnThis(),
                  select: jest.fn().mockReturnThis(),
                  where: jest.fn().mockReturnThis(),
                  executeTakeFirst: jest.fn().mockResolvedValue(null), // no overlap
                };
              }
              return {
                selectAll: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                executeTakeFirst: jest.fn().mockResolvedValue(null),
              };
            }),
            updateTable: jest.fn().mockReturnValue({
              set: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue([]),
            }),
            insertInto: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue([]),
            }),
          };

          return cb(mockTrx as unknown as DatabaseTransaction);
        },
      );

      const result = await bookingsService.holdSlot('patient-1', { slot_id: 'slot-1' });

      expect(result.consultation_id).toBe('mock-id-v7');
      expect(result.status).toBe('PENDING_PAYMENT');
      expect(result.fee_amount).toBe(1000);
      expect(mockOutbox.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'booking.held',
        'consultation',
        'mock-id-v7',
        expect.objectContaining({
          consultationId: 'mock-id-v7',
          slotId: 'slot-1',
        }),
      );
    });
  });
});
