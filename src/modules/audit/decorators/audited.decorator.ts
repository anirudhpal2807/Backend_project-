import { SetMetadata } from '@nestjs/common';

export const AUDIT_METADATA_KEY = 'audit:metadata';

export interface AuditOptions {
  action: string;
  resourceType: string;
  getResourceId?: (req: unknown, res?: unknown) => string;
}

export const Audited = (options: AuditOptions) => SetMetadata(AUDIT_METADATA_KEY, options);
