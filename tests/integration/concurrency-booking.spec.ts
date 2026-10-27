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

describe('Concurrency & Anti-Double-Booking Protection (T-067)', () => {
  let bookingsService: BookingsService;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockUow: jest.Mocked<UnitOfWork>;
  let mockIdGenerator: jest.Mocked<IIdGenerator>;
  let mockLogger: jest.Mocked<AppLoggerService>;
  let mockOutbox: jest.Mocked<OutboxService>;
  let mockPayments: jest.Mocked<PaymentsService>;

  // Simulated slot in memory
  let slotState: {
    id: string;
    doctor_id: string;
    status: 'OPEN' | 'HELD' | 'BOOKED' | 'BLOCKED';
    start_at: Date;
    end_at: Date;
    held_until: Date | null;
  };

  beforeEach(() => {
    slotState = {
      id: 'slot-uuid-1',
      doctor_id: 'doc-uuid-1',
      status: 'OPEN',
      start_at: new Date(Date.now() + 86400000),
      end_at: new Date(Date.now() + 86400000 + 1800000),
      held_until: null,
    };

    mockDbService = {
      db: {} as unknown,
    } as unknown as jest.Mocked<DatabaseService>;

    // Serialized transactional lock execution simulating PostgreSQL row-level locks
    let lockQueue = Promise.resolve();

    mockUow = {
      withTransaction: jest
        .fn()
        .mockImplementation(async (callback: (trx: DatabaseTransaction) => Promise<unknown>) => {
          // Enqueue to simulate database row-level lock serialization
          return new Promise((resolve, reject) => {
            lockQueue = lockQueue.then(async () => {
              try {
                const mockTrx = {
                  selectFrom: jest.fn().mockImplementation((table: string) => {
                    if (table === 'availability_slots') {
                      return {
                        selectAll: jest.fn().mockReturnThis(),
                        where: jest.fn().mockReturnThis(),
                        forUpdate: jest.fn().mockReturnThis(),
                        executeTakeFirst: jest
                          .fn()
                          .mockImplementation(async () => ({ ...slotState })),
                      };
                    }
                    if (table === 'doctors') {
                      return {
                        select: jest.fn().mockReturnThis(),
                        where: jest.fn().mockReturnThis(),
                        executeTakeFirst: jest.fn().mockResolvedValue({
                          id: 'doc-uuid-1',
                          status: 'VERIFIED',
                          consultation_fee: 1000,
                        }),
                      };
                    }
                    if (table === 'consultations as c') {
                      return {
                        innerJoin: jest.fn().mockReturnThis(),
                        select: jest.fn().mockReturnThis(),
                        where: jest.fn().mockReturnThis(),
                        executeTakeFirst: jest.fn().mockResolvedValue(null),
                      };
                    }
                    return {
                      selectAll: jest.fn().mockReturnThis(),
                      where: jest.fn().mockReturnThis(),
                      executeTakeFirst: jest.fn().mockResolvedValue(null),
                    };
                  }),
                  updateTable: jest.fn().mockReturnValue({
                    set: jest.fn().mockImplementation((updates: Record<string, unknown>) => {
                      if (updates.status)
                        slotState.status = updates.status as 'OPEN' | 'HELD' | 'BOOKED';
                      if (updates.held_until) slotState.held_until = updates.held_until as Date;
                      return {
                        where: jest.fn().mockReturnThis(),
                        execute: jest.fn().mockResolvedValue([]),
                      };
                    }),
                  }),
                  insertInto: jest.fn().mockReturnValue({
                    values: jest.fn().mockReturnThis(),
                    execute: jest.fn().mockResolvedValue([]),
                  }),
                };

                const res = await callback(mockTrx as unknown as DatabaseTransaction);
                resolve(res);
              } catch (err) {
                reject(err);
              }
            });
          });
        }),
      withRetry: jest.fn(),
    } as unknown as jest.Mocked<UnitOfWork>;

    mockIdGenerator = {
      generate: jest
        .fn()
        .mockImplementation(() => `c_${Math.random().toString(36).substring(2, 9)}`),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    mockOutbox = {
      publishInTransaction: jest.fn().mockResolvedValue({ id: 'outbox-id' }),
      pollAndDispatch: jest.fn(),
    } as unknown as jest.Mocked<OutboxService>;

    mockPayments = {} as unknown as jest.Mocked<PaymentsService>;

    bookingsService = new BookingsService(
      mockDbService,
      mockUow,
      mockIdGenerator,
      mockLogger,
      mockOutbox,
      mockPayments,
    );
  });

  it('exactly 1 booking succeeds and all other parallel attempts fail with 409 Conflict', async () => {
    const parallelAttempts = 100; // 100 parallel concurrent booking attempts
    const promises: Promise<unknown>[] = [];

    for (let i = 0; i < parallelAttempts; i++) {
      const patientId = `patient-concurrent-${i}`;
      promises.push(
        bookingsService
          .holdSlot(patientId, { slot_id: 'slot-uuid-1' })
          .then(res => ({ success: true, res }))
          .catch(err => ({ success: false, err })),
      );
    }

    const results = (await Promise.all(promises)) as Array<
      { success: true; res: { consultation_id: string } } | { success: false; err: AppException }
    >;

    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    // CRITICAL ACCEPTANCE CRITERIA: Exactly 1 success, zero double-booking
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(parallelAttempts - 1);

    // All failures must be 409 Conflict (SLOT_NOT_AVAILABLE)
    for (const failure of failures) {
      if (!failure.success) {
        expect(failure.err).toBeInstanceOf(AppException);
        expect(failure.err.getStatus()).toBe(409);
        expect(failure.err.code).toBe(ErrorCode.SLOT_NOT_AVAILABLE);
      }
    }

    expect(slotState.status).toBe('HELD');
  });
});
