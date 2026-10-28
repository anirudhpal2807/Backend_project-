import { AuditService, GENESIS_HASH } from '../../src/modules/audit/audit.service';
import { DatabaseService } from '../../src/infra/db/database.service';

describe('Audit Coverage Checklist (T-091)', () => {
  let auditService: AuditService;
  let recordedEntries: Array<Record<string, unknown>> = [];
  let mockDb: Record<string, jest.Mock>;
  let mockDatabaseService: Partial<DatabaseService>;

  beforeEach(() => {
    recordedEntries = [];

    mockDb = {
      selectFrom: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockImplementation(() => {
          if (recordedEntries.length === 0) {
            return Promise.resolve(undefined);
          }
          return Promise.resolve({
            hash: recordedEntries[recordedEntries.length - 1].hash,
          });
        }),
      }),
      insertInto: jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation(val => {
          recordedEntries.push(val);
          return {
            execute: jest.fn().mockResolvedValue([]),
          };
        }),
      }),
    };

    mockDatabaseService = {
      get db() {
        return mockDb;
      },
    };

    auditService = new AuditService(mockDatabaseService as DatabaseService);
  });

  const REQUIRED_AUDIT_DOMAINS = [
    {
      domain: 'auth',
      actions: ['auth.login', 'auth.register', 'auth.mfa_verify', 'auth.refresh_token'],
    },
    {
      domain: 'roles',
      actions: ['role.assigned', 'role.revoked'],
    },
    {
      domain: 'bookings',
      actions: ['booking.held', 'booking.cancelled'],
    },
    {
      domain: 'payments',
      actions: ['payment.initiated', 'payment.succeeded', 'payment.refunded'],
    },
    {
      domain: 'consultation',
      actions: ['consultation.started', 'consultation.notes_updated', 'consultation.completed'],
    },
    {
      domain: 'prescription',
      actions: ['prescription.created', 'prescription.amended', 'prescription.read'],
    },
    {
      domain: 'admin',
      actions: ['doctor.verified', 'doctor.rejected', 'user.anonymized'],
    },
  ];

  it('should cover all required compliance domains without data loss', async () => {
    let prevHash = GENESIS_HASH;

    for (const group of REQUIRED_AUDIT_DOMAINS) {
      for (const action of group.actions) {
        const id = await auditService.record({
          actorId: 'test-actor-id',
          actorRole: 'ADMIN',
          action,
          resourceType: group.domain,
          resourceId: `res-${action}`,
          outcome: 'SUCCESS',
          metadata: { test_field: 'sample_value' },
        });

        expect(id).toBeDefined();
        const recorded = recordedEntries[recordedEntries.length - 1];
        expect(recorded.action).toBe(action);
        expect(recorded.prev_hash).toBe(prevHash);
        expect(recorded.hash).toHaveLength(64);
        prevHash = recorded.hash;
      }
    }

    const totalCoveredActions = REQUIRED_AUDIT_DOMAINS.reduce(
      (sum, g) => sum + g.actions.length,
      0,
    );
    expect(recordedEntries.length).toBe(totalCoveredActions);
  });

  it('should ensure no raw sensitive data or PHI leaks into audit logs', async () => {
    await auditService.record({
      actorId: 'test-actor-id',
      actorRole: 'PATIENT',
      action: 'auth.login',
      resourceType: 'auth',
      resourceId: 'login-session',
      outcome: 'SUCCESS',
      metadata: {
        password: 'SuperSecretPassword!',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        clinical_notes: 'Patient suffers from chronic hypertension and insomnia.',
        clinical_notes_encrypted: 'cipher_data_string',
      },
    });

    const recorded = recordedEntries[0];
    const metadataParsed = JSON.parse(recorded.metadata);

    expect(metadataParsed.password).toBe('[REDACTED]');
    expect(metadataParsed.token).toBe('[REDACTED]');
    expect(metadataParsed.clinical_notes).toBe('[REDACTED]');
    expect(metadataParsed.clinical_notes_encrypted).toBe('[REDACTED]');
  });
});
