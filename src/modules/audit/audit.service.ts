import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../../infra/db/database.service';
import { Database } from '../../infra/db/database.types';
import { Transaction, sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { RequestContext } from '../../common/context/request-context';
import { redactSensitiveData } from '../../common/logger/redaction.util';
import { QueryAuditLogsDto, RecordAuditInput, VerifyChainResult } from './dto/audit.dto';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor-pagination';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function computeMetadataHash(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return 'EMPTY';
  }
  const sortedKeys = Object.keys(metadata).sort();
  const sortedObj: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sortedObj[k] = metadata[k];
  }
  return crypto.createHash('sha256').update(JSON.stringify(sortedObj), 'utf8').digest('hex');
}

export function computeAuditEntryHash(
  prevHash: string,
  entry: {
    id: string;
    actor_id: string | null;
    actor_role: string;
    action: string;
    resource_type: string;
    resource_id: string;
    outcome: string;
    created_at: Date | string;
    metadata_hash?: string;
  },
): string {
  const ts =
    entry.created_at instanceof Date
      ? entry.created_at.toISOString()
      : new Date(entry.created_at).toISOString();
  const canonicalString = [
    prevHash,
    entry.id,
    entry.actor_id ?? 'SYSTEM',
    entry.actor_role,
    entry.action,
    entry.resource_type,
    entry.resource_id,
    entry.outcome,
    entry.metadata_hash ?? 'EMPTY',
    ts,
  ].join('|');

  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Records an immutable, hash-chained audit entry.
   * Can be executed inside an existing database transaction to ensure atomicity.
   */
  async record(input: RecordAuditInput, trx?: Transaction<Database>): Promise<string> {
    const executor = trx ?? this.dbService.db;
    const ctx = RequestContext.get();

    const actorId = input.actorId ?? ctx?.actorId ?? null;
    const actorRole = input.actorRole ?? ctx?.actorRole ?? 'SYSTEM';
    const ipAddress = input.ipAddress ?? ctx?.ipAddress ?? null;
    const userAgent = input.userAgent ?? ctx?.userAgent ?? null;
    const requestId = input.requestId ?? ctx?.requestId ?? null;

    // Fetch the latest entry hash to maintain the cryptographic hash chain
    const latestEntry = await executor
      .selectFrom('audit_logs')
      .select(['hash'])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    const prevHash = latestEntry?.hash ?? GENESIS_HASH;
    const id = uuidv7();
    const createdAt = new Date();

    // Redact any potential PHI/PII or credentials from metadata before storing
    const redactedMetadata = input.metadata
      ? (redactSensitiveData(input.metadata) as Record<string, unknown>)
      : null;
    const metadataHash = computeMetadataHash(redactedMetadata);

    const hash = computeAuditEntryHash(prevHash, {
      id,
      actor_id: actorId,
      actor_role: actorRole,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      outcome: input.outcome,
      created_at: createdAt,
      metadata_hash: metadataHash,
    });

    await executor
      .insertInto('audit_logs')
      .values({
        id,
        actor_id: actorId,
        actor_role: actorRole,
        action: input.action,
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        outcome: input.outcome,
        ip_address: ipAddress,
        user_agent: userAgent,
        request_id: requestId,
        prev_hash: prevHash,
        hash,
        metadata: redactedMetadata ? JSON.stringify(redactedMetadata) : null,
        created_at: createdAt,
      })
      .execute();

    return id;
  }

  /**
   * Verifies the cryptographic hash-chain across audit logs.
   * Detects any insertions, modifications, deletions, or metadata tampering.
   */
  async verifyChain(options?: { fromDate?: Date; toDate?: Date }): Promise<VerifyChainResult> {
    let query = this.dbService.db
      .selectFrom('audit_logs')
      .selectAll()
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');

    if (options?.fromDate) {
      query = query.where('created_at', '>=', options.fromDate);
    }
    if (options?.toDate) {
      query = query.where('created_at', '<=', options.toDate);
    }

    const logs = await query.execute();

    if (logs.length === 0) {
      return {
        verified: true,
        total_entries: 0,
        message: 'No audit log entries to verify',
      };
    }

    let expectedPrevHash = logs[0].prev_hash ?? GENESIS_HASH;
    let checkedCount = 0;

    for (const entry of logs) {
      // 1. Verify prev_hash matches the previous record's hash
      if (entry.prev_hash !== expectedPrevHash) {
        return {
          verified: false,
          total_entries: checkedCount,
          broken_at_id: entry.id,
          reason: `Broken chain at entry ${entry.id}: expected prev_hash ${expectedPrevHash}, found ${entry.prev_hash}`,
          message: 'Audit log integrity check FAILED: Chain broken',
        };
      }

      // 2. Recompute hash and verify integrity
      let metaObj: Record<string, unknown> | null = null;
      if (entry.metadata) {
        try {
          metaObj =
            typeof entry.metadata === 'string'
              ? JSON.parse(entry.metadata)
              : (entry.metadata as Record<string, unknown>);
        } catch {
          metaObj = null;
        }
      }

      const metaHash = computeMetadataHash(metaObj);
      const recomputedHash = computeAuditEntryHash(entry.prev_hash, {
        id: entry.id,
        actor_id: entry.actor_id,
        actor_role: entry.actor_role,
        action: entry.action,
        resource_type: entry.resource_type,
        resource_id: entry.resource_id,
        outcome: entry.outcome,
        created_at: entry.created_at,
        metadata_hash: metaHash,
      });

      if (recomputedHash !== entry.hash) {
        return {
          verified: false,
          total_entries: checkedCount,
          broken_at_id: entry.id,
          reason: `Tampering detected at entry ${entry.id}: stored hash ${entry.hash} does not match computed hash ${recomputedHash}`,
          message: 'Audit log integrity check FAILED: Content tampered',
        };
      }

      expectedPrevHash = entry.hash;
      checkedCount++;
    }

    return {
      verified: true,
      total_entries: checkedCount,
      message: `Audit chain integrity successfully verified across ${checkedCount} entries`,
    };
  }

  /**
   * Queries audit logs with filtering and keyset pagination.
   */
  async listLogs(dto: QueryAuditLogsDto) {
    const limit = dto.limit ?? 50;
    let query = this.dbService.db
      .selectFrom('audit_logs')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);

    if (dto.actor_id) {
      query = query.where('actor_id', '=', dto.actor_id);
    }
    if (dto.actor_role) {
      query = query.where('actor_role', '=', dto.actor_role);
    }
    if (dto.action) {
      query = query.where('action', '=', dto.action);
    }
    if (dto.resource_type) {
      query = query.where('resource_type', '=', dto.resource_type);
    }
    if (dto.resource_id) {
      query = query.where('resource_id', '=', dto.resource_id);
    }
    if (dto.outcome) {
      query = query.where('outcome', '=', dto.outcome);
    }
    if (dto.from_date) {
      query = query.where('created_at', '>=', new Date(dto.from_date));
    }
    if (dto.to_date) {
      query = query.where('created_at', '<=', new Date(dto.to_date));
    }

    if (dto.cursor) {
      const decoded = decodeCursor(dto.cursor);
      if (decoded && decoded.timestamp && decoded.id) {
        query = query.where(
          sql<boolean>`(created_at, id) < (${new Date(String(decoded.timestamp))}, ${String(decoded.id)})`,
        );
      }
    }

    const rows = await query.execute();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        id: last.id,
        timestamp: new Date(last.created_at).toISOString(),
      });
    }

    return {
      data: items,
      pagination: {
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
      },
    };
  }

  /**
   * Exports audit logs with a SHA-256 integrity checksum header.
   */
  async exportLogs(dto: QueryAuditLogsDto) {
    const results = await this.listLogs({ ...dto, limit: 100 });
    const payload = JSON.stringify(results.data, null, 2);
    const checksum = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');

    return {
      export_timestamp: new Date().toISOString(),
      checksum_sha256: checksum,
      total_records: results.data.length,
      data: results.data,
    };
  }

  /**
   * GDPR / HIPAA Anonymization flow (T-094):
   * Erases patient/user PII in profile tables while preserving immutable financial
   * and clinical audit trail tokens for statutory retention requirements.
   */
  async anonymizeUser(
    userId: string,
    requestingActorId: string,
  ): Promise<{ status: string; user_id: string }> {
    await this.dbService.db.transaction().execute(async trx => {
      // 1. Scrub user profile PII
      await trx
        .updateTable('profiles')
        .set({
          first_name_encrypted: 'ANONYMIZED',
          last_name_encrypted: 'USER',
          phone_encrypted: 'ANONYMIZED',
          dob_encrypted: 'ANONYMIZED',
          gender: 'OTHER',
          updated_at: new Date(),
        })
        .where('user_id', '=', userId)
        .execute();

      // 2. Anonymize user email & deactivate
      const anonEmail = `anonymized_${userId.slice(0, 8)}@redacted.amrutam.global`;
      await trx
        .updateTable('users')
        .set({
          email: anonEmail,
          is_active: false,
          updated_at: new Date(),
        })
        .where('id', '=', userId)
        .execute();

      // 3. Record audit trail entry for the anonymization action
      await this.record(
        {
          actorId: requestingActorId,
          actorRole: 'ADMIN',
          action: 'user.anonymized',
          resourceType: 'user',
          resourceId: userId,
          outcome: 'SUCCESS',
          metadata: {
            reason: 'GDPR / HIPAA Right to Erasure / Anonymization Request',
            anonymized_user_id: userId,
          },
        },
        trx,
      );
    });

    return {
      status: 'USER_ANONYMIZED',
      user_id: userId,
    };
  }
}
