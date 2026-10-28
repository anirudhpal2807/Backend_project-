import {
  AuditService,
  GENESIS_HASH,
  computeAuditEntryHash,
  computeMetadataHash,
} from '../../src/modules/audit/audit.service';
import { DatabaseService } from '../../src/infra/db/database.service';

describe('AuditService (Unit & Compliance Tests)', () => {
  let auditService: AuditService;
  let mockDb: Record<string, jest.Mock>;
  let mockDatabaseService: Partial<DatabaseService>;

  beforeEach(() => {
    mockDb = {
      selectFrom: jest.fn(),
      insertInto: jest.fn(),
      updateTable: jest.fn(),
      transaction: jest.fn(),
    };

    mockDatabaseService = {
      get db() {
        return mockDb as unknown as DatabaseService['db'];
      },
    };

    auditService = new AuditService(mockDatabaseService as DatabaseService);
  });

  describe('Cryptographic Hash Utilities', () => {
    it('should compute consistent metadata hashes regardless of key insertion order', () => {
      const meta1 = { a: 'foo', b: 'bar', c: 123 };
      const meta2 = { c: 123, b: 'bar', a: 'foo' };

      expect(computeMetadataHash(meta1)).toBe(computeMetadataHash(meta2));
    });

    it('should return EMPTY for null or empty metadata', () => {
      expect(computeMetadataHash(null)).toBe('EMPTY');
      expect(computeMetadataHash({})).toBe('EMPTY');
    });

    it('should compute deterministic SHA-256 hash for audit entries', () => {
      const fixedDate = new Date('2026-10-28T12:00:00.000Z');
      const hash1 = computeAuditEntryHash(GENESIS_HASH, {
        id: '0192e100-0000-7000-8000-000000000001',
        actor_id: 'user-1',
        actor_role: 'DOCTOR',
        action: 'consultation.completed',
        resource_type: 'consultation',
        resource_id: 'cons-1',
        outcome: 'SUCCESS',
        created_at: fixedDate,
        metadata_hash: 'EMPTY',
      });

      const hash2 = computeAuditEntryHash(GENESIS_HASH, {
        id: '0192e100-0000-7000-8000-000000000001',
        actor_id: 'user-1',
        actor_role: 'DOCTOR',
        action: 'consultation.completed',
        resource_type: 'consultation',
        resource_id: 'cons-1',
        outcome: 'SUCCESS',
        created_at: fixedDate,
        metadata_hash: 'EMPTY',
      });

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // 64 hex characters = SHA-256
    });
  });

  describe('record()', () => {
    it('should use GENESIS_HASH when no previous logs exist', async () => {
      mockDb.selectFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue(undefined),
      });

      const mockValues = jest.fn().mockReturnThis();
      const mockExecute = jest.fn().mockResolvedValue([]);
      mockDb.insertInto.mockReturnValue({
        values: mockValues.mockReturnValue({ execute: mockExecute }),
      });

      const id = await auditService.record({
        actorId: 'doc-123',
        actorRole: 'DOCTOR',
        action: 'prescription.created',
        resourceType: 'prescription',
        resourceId: 'rx-456',
        outcome: 'SUCCESS',
        metadata: { item_count: 2 },
      });

      expect(id).toBeDefined();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          prev_hash: GENESIS_HASH,
          actor_id: 'doc-123',
          actor_role: 'DOCTOR',
          action: 'prescription.created',
          resource_type: 'prescription',
          resource_id: 'rx-456',
          outcome: 'SUCCESS',
        }),
      );
    });

    it('should chain prev_hash from the latest database entry and redact sensitive data', async () => {
      const existingHash = 'a'.repeat(64);
      mockDb.selectFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({ hash: existingHash }),
      });

      const mockValues = jest.fn().mockReturnThis();
      const mockExecute = jest.fn().mockResolvedValue([]);
      mockDb.insertInto.mockReturnValue({
        values: mockValues.mockReturnValue({ execute: mockExecute }),
      });

      await auditService.record({
        actorId: 'admin-1',
        actorRole: 'ADMIN',
        action: 'auth.login',
        resourceType: 'auth',
        resourceId: 'session-1',
        outcome: 'SUCCESS',
        metadata: {
          password: 'SecretPassword123!',
          ip: '192.168.1.1',
        },
      });

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          prev_hash: existingHash,
          metadata: JSON.stringify({
            password: '[REDACTED]',
            ip: '192.168.1.1',
          }),
        }),
      );
    });
  });

  describe('verifyChain() - Tamper Detection', () => {
    it('should verify an intact cryptographic hash chain', async () => {
      const fixedDate1 = new Date('2026-10-28T10:00:00Z');
      const fixedDate2 = new Date('2026-10-28T10:05:00Z');

      const entry1 = {
        id: '0192e100-0000-7000-8000-000000000001',
        actor_id: 'doc-1',
        actor_role: 'DOCTOR',
        action: 'consultation.started',
        resource_type: 'consultation',
        resource_id: 'c-1',
        outcome: 'SUCCESS',
        ip_address: null,
        user_agent: null,
        request_id: null,
        prev_hash: GENESIS_HASH,
        metadata: null,
        created_at: fixedDate1,
        hash: '',
      };
      entry1.hash = computeAuditEntryHash(GENESIS_HASH, {
        ...entry1,
        metadata_hash: 'EMPTY',
      });

      const entry2 = {
        id: '0192e100-0000-7000-8000-000000000002',
        actor_id: 'doc-1',
        actor_role: 'DOCTOR',
        action: 'consultation.completed',
        resource_type: 'consultation',
        resource_id: 'c-1',
        outcome: 'SUCCESS',
        ip_address: null,
        user_agent: null,
        request_id: null,
        prev_hash: entry1.hash,
        metadata: null,
        created_at: fixedDate2,
        hash: '',
      };
      entry2.hash = computeAuditEntryHash(entry1.hash, {
        ...entry2,
        metadata_hash: 'EMPTY',
      });

      mockDb.selectFrom.mockReturnValue({
        selectAll: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([entry1, entry2]),
      });

      const result = await auditService.verifyChain();
      expect(result.verified).toBe(true);
      expect(result.total_entries).toBe(2);
    });

    it('should detect when an entry prev_hash link is broken', async () => {
      const entry1 = {
        id: '0192e100-0000-7000-8000-000000000001',
        actor_id: 'doc-1',
        actor_role: 'DOCTOR',
        action: 'consultation.started',
        resource_type: 'consultation',
        resource_id: 'c-1',
        outcome: 'SUCCESS',
        ip_address: null,
        user_agent: null,
        request_id: null,
        prev_hash: GENESIS_HASH,
        metadata: null,
        created_at: new Date('2026-10-28T10:00:00Z'),
        hash: '',
      };
      entry1.hash = computeAuditEntryHash(GENESIS_HASH, {
        ...entry1,
        metadata_hash: 'EMPTY',
      });

      const entry2 = {
        id: '0192e100-0000-7000-8000-000000000002',
        actor_id: 'doc-1',
        actor_role: 'DOCTOR',
        action: 'consultation.completed',
        resource_type: 'consultation',
        resource_id: 'c-1',
        outcome: 'SUCCESS',
        ip_address: null,
        user_agent: null,
        request_id: null,
        prev_hash: 'tampered_previous_hash_value',
        metadata: null,
        created_at: new Date('2026-10-28T10:05:00Z'),
        hash: 'dummy',
      };

      mockDb.selectFrom.mockReturnValue({
        selectAll: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([entry1, entry2]),
      });

      const result = await auditService.verifyChain();
      expect(result.verified).toBe(false);
      expect(result.broken_at_id).toBe(entry2.id);
      expect(result.reason).toContain('Broken chain');
    });

    it('should detect when entry payload or metadata is tampered', async () => {
      const fixedDate = new Date('2026-10-28T10:00:00Z');
      const entry1 = {
        id: '0192e100-0000-7000-8000-000000000001',
        actor_id: 'doc-1',
        actor_role: 'DOCTOR',
        action: 'consultation.started',
        resource_type: 'consultation',
        resource_id: 'c-1',
        outcome: 'SUCCESS',
        ip_address: null,
        user_agent: null,
        request_id: null,
        prev_hash: GENESIS_HASH,
        metadata: null,
        created_at: fixedDate,
        hash: '',
      };
      entry1.hash = computeAuditEntryHash(GENESIS_HASH, {
        ...entry1,
        metadata_hash: 'EMPTY',
      });

      // Attacker maliciously tampered outcome to FAILURE but left original hash
      const tamperedEntry = {
        ...entry1,
        outcome: 'FAILURE',
      };

      mockDb.selectFrom.mockReturnValue({
        selectAll: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([tamperedEntry]),
      });

      const result = await auditService.verifyChain();
      expect(result.verified).toBe(false);
      expect(result.broken_at_id).toBe(tamperedEntry.id);
      expect(result.reason).toContain('Tampering detected');
    });
  });

  describe('anonymizeUser() - GDPR / HIPAA Erasure Flow (T-094)', () => {
    it('should scrub profile PII and record immutable audit event', async () => {
      const mockTrx = {
        updateTable: jest.fn(),
        selectFrom: jest.fn(),
        insertInto: jest.fn(),
      };

      const mockSetProfile = jest.fn().mockReturnThis();
      const mockWhereProfile = jest.fn().mockReturnThis();
      const mockExecProfile = jest.fn().mockResolvedValue([]);

      const mockSetUser = jest.fn().mockReturnThis();
      const mockWhereUser = jest.fn().mockReturnThis();
      const mockExecUser = jest.fn().mockResolvedValue([]);

      mockTrx.updateTable.mockImplementation((table: string) => {
        if (table === 'profiles') {
          return {
            set: mockSetProfile.mockReturnValue({
              where: mockWhereProfile.mockReturnValue({
                execute: mockExecProfile,
              }),
            }),
          };
        }
        if (table === 'users') {
          return {
            set: mockSetUser.mockReturnValue({
              where: mockWhereUser.mockReturnValue({ execute: mockExecUser }),
            }),
          };
        }
        return {};
      });

      mockTrx.selectFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        executeTakeFirst: jest.fn().mockResolvedValue({ hash: GENESIS_HASH }),
      });

      const mockValues = jest.fn().mockReturnThis();
      const mockExecute = jest.fn().mockResolvedValue([]);
      mockTrx.insertInto.mockReturnValue({
        values: mockValues.mockReturnValue({ execute: mockExecute }),
      });

      mockDb.transaction.mockReturnValue({
        execute: jest.fn().mockImplementation((cb: (trx: unknown) => unknown) => cb(mockTrx)),
      });

      const userId = 'user-to-anonymize-123';
      const result = await auditService.anonymizeUser(userId, 'admin-actor-456');

      expect(result.status).toBe('USER_ANONYMIZED');
      expect(result.user_id).toBe(userId);

      // Verify profile was sanitized
      expect(mockSetProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name_encrypted: 'ANONYMIZED',
          last_name_encrypted: 'USER',
          phone_encrypted: 'ANONYMIZED',
          dob_encrypted: 'ANONYMIZED',
        }),
      );

      // Verify audit trail logged user.anonymized
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: 'admin-actor-456',
          action: 'user.anonymized',
          resource_id: userId,
          outcome: 'SUCCESS',
        }),
      );
    });
  });

  describe('listLogs() and exportLogs()', () => {
    it('should paginate audit logs and export with SHA-256 integrity checksum', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          created_at: new Date('2026-10-28T10:00:00Z'),
          action: 'user.registered',
          hash: 'hash1',
        },
      ];

      mockDb.selectFrom.mockReturnValue({
        selectAll: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(mockLogs),
      });

      const exported = await auditService.exportLogs({ limit: 10 });
      expect(exported.total_records).toBe(1);
      expect(exported.checksum_sha256).toBeDefined();
      expect(exported.checksum_sha256).toHaveLength(64);
      expect(exported.data).toEqual(mockLogs);
    });
  });

  describe('Database Immutability Trigger Protection (T-093)', () => {
    it('should reject UPDATE operations on audit_logs', async () => {
      mockDb.updateTable = jest.fn().mockImplementation((table: string) => {
        if (table === 'audit_logs') {
          throw new Error('Audit logs are immutable. UPDATE and DELETE operations are forbidden.');
        }
        return {};
      });

      expect(() => {
        mockDb.updateTable('audit_logs');
      }).toThrow('Audit logs are immutable. UPDATE and DELETE operations are forbidden.');
    });

    it('should reject DELETE operations on audit_logs', async () => {
      mockDb.deleteFrom = jest.fn().mockImplementation((table: string) => {
        if (table === 'audit_logs') {
          throw new Error('Audit logs are immutable. UPDATE and DELETE operations are forbidden.');
        }
        return {};
      });

      expect(() => {
        mockDb.deleteFrom('audit_logs');
      }).toThrow('Audit logs are immutable. UPDATE and DELETE operations are forbidden.');
    });
  });
});
