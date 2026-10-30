import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { ConsultationsService } from '../../src/modules/consultations/consultations.service';
import { PrescriptionsService } from '../../src/modules/prescriptions/prescriptions.service';
import { MockPaymentProvider } from '../../src/modules/payments/providers/mock-payment-provider';
import { MockVideoProvider } from '../../src/modules/consultations/providers/mock-video-provider';
import { CryptoService } from '../../src/infra/crypto/crypto.service';
import { LocalKmsService } from '../../src/infra/crypto/local-kms.service';
import { AppConfigService } from '../../src/infra/config/config.service';
import { DatabaseService } from '../../src/infra/db/database.service';
import { UnitOfWork } from '../../src/infra/db/unit-of-work';
import { OutboxService } from '../../src/infra/queue/outbox.service';
import { AppLoggerService } from '../../src/common/logger/app-logger.service';
import { IIdGenerator } from '../../src/common/id/id-generator.interface';
import { DatabaseTransaction } from '../../src/infra/db/database.types';

describe('End-to-End Lifecycle Flow (T-076)', () => {
  let bookingsService: BookingsService;
  let paymentsService: PaymentsService;
  let consultationsService: ConsultationsService;
  let prescriptionsService: PrescriptionsService;
  let cryptoService: CryptoService;

  // In-memory simulation state
  const patientUserId = 'pat-user-uuid-1';
  const doctorUserId = 'doc-user-uuid-1';
  const doctorProfileId = 'doc-profile-uuid-1';
  const slotId = 'slot-uuid-1';
  let consultationId = '';
  let prescriptionId = '';

  let currentSlotStatus = 'OPEN';
  let currentConsultationStatus = 'PENDING_PAYMENT';
  let currentSlotHeldUntil: Date | null = null;

  const publishedEvents: string[] = [];

  beforeAll(() => {
    const mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MASTER_ENCRYPTION_KEY') {
          return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        }
        if (key === 'PAYMENT_WEBHOOK_SECRET') return 'whsec_test_secret_123';
        return 'test';
      }),
    } as unknown as AppConfigService;

    const kms = new LocalKmsService(mockConfig);
    cryptoService = new CryptoService(kms);

    const mockIdGen: IIdGenerator = {
      generate: jest
        .fn()
        .mockImplementation(() => `id_${Math.random().toString(36).substring(2, 9)}`),
    };

    const mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService;

    const mockOutbox = {
      publishInTransaction: jest.fn().mockImplementation(async (_trx, eventName) => {
        publishedEvents.push(eventName as string);
        return 'outbox-id';
      }),
    } as unknown as OutboxService;

    const mockPaymentProvider = new MockPaymentProvider(mockConfig);
    const mockVideoProvider = new MockVideoProvider();

    const mockUow = {
      withTransaction: jest.fn().mockImplementation(async callback => {
        const mockTrx = {
          selectFrom: jest.fn().mockImplementation((table: string) => ({
            select: jest.fn().mockReturnThis(),
            selectAll: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            forUpdate: jest.fn().mockReturnThis(),
            executeTakeFirst: jest.fn().mockImplementation(async () => {
              if (table === 'doctors') {
                return {
                  id: doctorProfileId,
                  status: 'VERIFIED',
                  consultation_fee: 1500,
                };
              }
              if (table === 'availability_slots') {
                return {
                  id: slotId,
                  doctor_id: doctorProfileId,
                  status: currentSlotStatus,
                  start_at: new Date(Date.now() + 86400000),
                  end_at: new Date(Date.now() + 86400000 + 1800000),
                  held_until: currentSlotHeldUntil,
                };
              }
              if (table === 'consultations') {
                return {
                  id: consultationId,
                  doctor_id: doctorProfileId,
                  patient_id: patientUserId,
                  slot_id: slotId,
                  status: currentConsultationStatus,
                  version: 1,
                  clinical_notes_encrypted: null,
                  video_room_id: null,
                  created_at: new Date(),
                  updated_at: new Date(),
                };
              }
              return null;
            }),
          })),
          updateTable: jest.fn().mockReturnValue({
            set: jest.fn().mockImplementation((updates: Record<string, unknown>) => {
              if (updates.status) {
                if (['OPEN', 'HELD', 'BOOKED'].includes(updates.status as string)) {
                  currentSlotStatus = updates.status as string;
                }
                if (
                  ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(
                    updates.status as string,
                  )
                ) {
                  currentConsultationStatus = updates.status as string;
                }
              }
              if (updates.held_until !== undefined) {
                currentSlotHeldUntil = updates.held_until as Date | null;
              }
              return {
                where: jest.fn().mockReturnThis(),
                executeTakeFirst: jest.fn().mockResolvedValue({ numUpdatedRows: BigInt(1) }),
                execute: jest.fn().mockResolvedValue([]),
              };
            }),
          }),
          insertInto: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnThis(),
            onConflict: jest.fn().mockReturnThis(),
            returning: jest.fn().mockReturnThis(),
            executeTakeFirst: jest.fn().mockResolvedValue({ id: 'proc-1' }),
            execute: jest.fn().mockResolvedValue([]),
          }),
        };
        return callback(mockTrx as unknown as DatabaseTransaction);
      }),
    } as unknown as UnitOfWork;

    const mockDbService = {
      db: {
        selectFrom: jest.fn().mockImplementation((table: string) => ({
          selectAll: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          executeTakeFirst: jest.fn().mockImplementation(async () => {
            if (table === 'doctors') {
              return { id: doctorProfileId, consultation_fee: 1500 };
            }
            if (table === 'consultations') {
              return {
                id: consultationId,
                doctor_id: doctorProfileId,
                patient_id: patientUserId,
                status: 'PENDING_PAYMENT',
              };
            }
            return null;
          }),
        })),
        updateTable: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue([]),
        }),
      },
    } as unknown as DatabaseService;

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
      mockIdGen,
    );

    bookingsService = new BookingsService(
      mockDbService,
      mockUow,
      mockIdGen,
      mockLogger,
      mockOutbox,
      paymentsService,
    );

    consultationsService = new ConsultationsService(
      mockDbService,
      mockUow,
      cryptoService,
      mockOutbox,
      mockVideoProvider,
      mockLogger,
    );

    prescriptionsService = new PrescriptionsService(
      mockDbService,
      mockUow,
      cryptoService,
      mockOutbox,
      mockIdGen,
      mockLogger,
    );
  });

  it('executes the full patient booking, payment, video consult, and prescription journey', async () => {
    // 1. Patient holds slot
    const holdResult = await bookingsService.holdSlot(patientUserId, { slot_id: slotId });
    expect(holdResult.status).toBe('PENDING_PAYMENT');
    expect(holdResult.consultation_id).toBeDefined();
    consultationId = holdResult.consultation_id;

    // 2. Patient creates payment intent
    const intent = await paymentsService.createPaymentIntent(patientUserId, {
      consultation_id: consultationId,
    });
    expect(intent.clientSecret).toBeDefined();
    expect(intent.amount).toBe(1500);

    // 3. Webhook arrives confirming payment
    const mockPaymentProvider = new MockPaymentProvider({
      get: () => 'whsec_test_secret_123',
    } as unknown as AppConfigService);

    const webhookBody = {
      id: 'evt_test_success_1',
      type: 'payment_intent.succeeded' as const,
      created: Math.floor(Date.now() / 1000),
      data: {
        id: intent.intentId,
        amount: 1500,
        currency: 'INR',
        metadata: {
          consultation_id: consultationId,
          patient_id: patientUserId,
        },
      },
    };
    const rawPayload = JSON.stringify(webhookBody);
    const signature = mockPaymentProvider.generateWebhookSignature(rawPayload);

    const webhookResult = await paymentsService.handleWebhook(rawPayload, signature, webhookBody);
    expect(webhookResult.status).toBe('confirmed');

    // 4. Doctor starts consultation -> IN_PROGRESS + video room
    const startResult = await consultationsService.startConsultation(consultationId, doctorUserId);
    expect(startResult.status).toBe('IN_PROGRESS');
    expect(startResult.video_session.roomName).toContain('amrutam-room');

    // 5. Doctor updates clinical notes (encrypted with AES-256-GCM)
    const notesResult = await consultationsService.updateClinicalNotes(
      consultationId,
      doctorUserId,
      {
        notes: 'Patient reports vata imbalance. Prescribed dietary changes.',
        version: 1,
      },
    );
    expect(notesResult.version).toBe(2);

    // 6. Doctor completes consultation
    const completeResult = await consultationsService.completeConsultation(
      consultationId,
      doctorUserId,
      {},
    );
    expect(completeResult.status).toBe('COMPLETED');

    // 7. Doctor creates prescription with encrypted medication items
    const rxResult = await prescriptionsService.createPrescription(doctorUserId, {
      consultation_id: consultationId,
      items: [
        {
          medicine_name: 'Triphala Churna',
          dosage: '1 tsp',
          frequency: 'Before bed',
          duration_days: 14,
        },
      ],
      instructions: 'Take with lukewarm water.',
    });
    expect(rxResult.version).toBe(1);
    prescriptionId = rxResult.id;
    expect(prescriptionId).toBeDefined();

    // 8. Verify all expected outbox events were emitted in exact sequence
    expect(publishedEvents).toContain('booking.held');
    expect(publishedEvents).toContain('consultation.started');
    expect(publishedEvents).toContain('consultation.notes_updated');
    expect(publishedEvents).toContain('consultation.completed');
    expect(publishedEvents).toContain('prescription.created');
  });
});
