import { PaymentsService } from '../../src/modules/payments/payments.service';
import { DatabaseService } from '../../src/infra/db/database.service';
import { UnitOfWork } from '../../src/infra/db/unit-of-work';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock-payment-provider';
import { OutboxService } from '../../src/infra/queue/outbox.service';
import { AppLoggerService } from '../../src/common/logger/app-logger.service';
import { IIdGenerator } from '../../src/common/id/id-generator.interface';
import { AppException } from '../../src/common/errors/app-exception';
import { DatabaseTransaction } from '../../src/infra/db/database.types';
import { PaymentWebhookPayload } from '../../src/modules/payments/dto/payment.dto';

describe('PaymentsService', () => {
  let paymentsService: PaymentsService;
  let mockDbService: jest.Mocked<DatabaseService>;
  let mockUow: jest.Mocked<UnitOfWork>;
  let mockPaymentProvider: jest.Mocked<MockPaymentProvider>;
  let mockOutbox: jest.Mocked<OutboxService>;
  let mockLogger: jest.Mocked<AppLoggerService>;
  let mockIdGenerator: jest.Mocked<IIdGenerator>;

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

    mockPaymentProvider = {
      createIntent: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      generateWebhookSignature: jest.fn().mockReturnValue('valid-sig'),
      refund: jest
        .fn()
        .mockResolvedValue({ refundId: 're_123', amount: 1000, status: 'SUCCEEDED' }),
    } as unknown as jest.Mocked<MockPaymentProvider>;

    mockOutbox = {
      publishInTransaction: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
      pollAndDispatch: jest.fn(),
    } as unknown as jest.Mocked<OutboxService>;

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    mockIdGenerator = {
      generate: jest.fn().mockReturnValue('mock-id'),
    };

    const mockCashfreeProvider = {
      isConfigured: jest.fn().mockReturnValue(false),
      createIntent: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      refund: jest.fn(),
    } as any;

    paymentsService = new PaymentsService(
      mockDbService,
      mockUow,
      mockPaymentProvider,
      mockCashfreeProvider,
      mockOutbox,
      mockLogger,
      mockIdGenerator,
    );
  });

  describe('handleWebhook', () => {
    const validPayload: PaymentWebhookPayload = {
      id: 'evt_123',
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        id: 'pi_123',
        amount: 1000,
        currency: 'INR',
        metadata: {
          consultation_id: '00000000-0000-0000-0000-000000000001',
          patient_id: '00000000-0000-0000-0000-000000000002',
        },
      },
    };

    it('should reject webhook with invalid signature', async () => {
      mockPaymentProvider.verifyWebhookSignature.mockReturnValueOnce(false);

      await expect(paymentsService.handleWebhook('{}', 'bad-sig', validPayload)).rejects.toThrow(
        AppException,
      );
    });

    it('should deduplicate webhook idempotently if already processed', async () => {
      mockUow.withTransaction.mockImplementation(
        async (cb: (trx: DatabaseTransaction) => Promise<unknown>) => {
          const mockTrx = {
            insertInto: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnThis(),
              onConflict: jest.fn().mockReturnThis(),
              returning: jest.fn().mockReturnThis(),
              executeTakeFirst: jest.fn().mockResolvedValue(null), // onConflict doNothing returned null
            }),
          };
          return cb(mockTrx as unknown as DatabaseTransaction);
        },
      );

      const result = await paymentsService.handleWebhook('{}', 'valid-sig', validPayload);
      expect(result).toEqual({ status: 'already_processed' });
    });

    it('should confirm consultation and book slot on payment success', async () => {
      mockUow.withTransaction.mockImplementation(
        async (cb: (trx: DatabaseTransaction) => Promise<unknown>) => {
          const mockConsultation = {
            id: validPayload.data.metadata.consultation_id,
            slot_id: 'slot-1',
            patient_id: validPayload.data.metadata.patient_id,
            doctor_id: 'doc-1',
            status: 'PENDING_PAYMENT',
            payment_status: 'PENDING',
            fee_amount: 1000,
          };

          const mockSlot = {
            id: 'slot-1',
            status: 'HELD',
            held_until: new Date(Date.now() + 300000), // active hold
          };

          const mockTrx = {
            insertInto: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnThis(),
              onConflict: jest.fn().mockReturnThis(),
              returning: jest.fn().mockReturnThis(),
              executeTakeFirst: jest.fn().mockResolvedValue({ id: 'proc-1' }),
              execute: jest.fn().mockResolvedValue([]),
            }),
            selectFrom: jest.fn().mockImplementation((table: string) => ({
              selectAll: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              forUpdate: jest.fn().mockReturnThis(),
              executeTakeFirst: jest
                .fn()
                .mockResolvedValue(table === 'consultations' ? mockConsultation : mockSlot),
            })),
            updateTable: jest.fn().mockReturnValue({
              set: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue([]),
            }),
          };

          return cb(mockTrx as unknown as DatabaseTransaction);
        },
      );

      const result = await paymentsService.handleWebhook('{}', 'valid-sig', validPayload);

      expect(result).toEqual({
        status: 'confirmed',
        consultationId: validPayload.data.metadata.consultation_id,
        provider: 'MOCK_STRIPE',
      });
      expect(mockOutbox.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'consultation.confirmed',
        'consultation',
        validPayload.data.metadata.consultation_id,
        expect.anything(),
      );
    });

    it('should trigger auto-refund compensation if late payment arrives after hold expired', async () => {
      mockUow.withTransaction.mockImplementation(
        async (cb: (trx: DatabaseTransaction) => Promise<unknown>) => {
          const mockConsultation = {
            id: validPayload.data.metadata.consultation_id,
            slot_id: 'slot-1',
            patient_id: validPayload.data.metadata.patient_id,
            doctor_id: 'doc-1',
            status: 'EXPIRED',
            payment_status: 'PENDING',
            fee_amount: 1000,
          };

          const mockSlot = {
            id: 'slot-1',
            status: 'OPEN',
            held_until: new Date(Date.now() - 60000), // expired 1 min ago
          };

          const mockTrx = {
            insertInto: jest.fn().mockReturnValue({
              values: jest.fn().mockReturnThis(),
              onConflict: jest.fn().mockReturnThis(),
              returning: jest.fn().mockReturnThis(),
              executeTakeFirst: jest.fn().mockResolvedValue({ id: 'proc-1' }),
              execute: jest.fn().mockResolvedValue([]),
            }),
            selectFrom: jest.fn().mockImplementation((table: string) => ({
              selectAll: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              forUpdate: jest.fn().mockReturnThis(),
              executeTakeFirst: jest
                .fn()
                .mockResolvedValue(table === 'consultations' ? mockConsultation : mockSlot),
            })),
            updateTable: jest.fn().mockReturnValue({
              set: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue([]),
            }),
          };

          return cb(mockTrx as unknown as DatabaseTransaction);
        },
      );

      const result = await paymentsService.handleWebhook('{}', 'valid-sig', validPayload);

      expect(result.status).toBe('late_payment_refunded');
      expect(mockPaymentProvider.refund).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: 'evt_123',
          amount: validPayload.data.amount,
        }),
      );
      expect(mockOutbox.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'consultation.auto_refunded',
        'consultation',
        validPayload.data.metadata.consultation_id,
        expect.anything(),
      );
    });
  });
});
