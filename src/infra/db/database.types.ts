import { Generated, ColumnType, Transaction } from 'kysely';

export type DatabaseTransaction = Transaction<Database>;

export type UserRole = 'PATIENT' | 'DOCTOR' | 'ADMIN' | 'AUDITOR';
export type DoctorStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';
export type SlotStatus = 'OPEN' | 'HELD' | 'BOOKED' | 'BLOCKED' | 'CANCELLED';
export type ConsultationStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'NO_SHOW'
  | 'REFUNDED';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
export type IdempotencyStatus = 'IN_FLIGHT' | 'COMPLETED' | 'FAILED';
export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UserRolesTable {
  id: Generated<string>;
  user_id: string;
  role: UserRole;
  created_at: Generated<Date>;
}

export interface ProfilesTable {
  id: Generated<string>;
  user_id: string;
  first_name_encrypted: string;
  last_name_encrypted: string;
  phone_encrypted: string;
  dob_encrypted: string;
  gender: string;
  key_version: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DoctorsTable {
  id: Generated<string>;
  user_id: string;
  license_number: string;
  experience_years: number;
  consultation_fee: ColumnType<number, number | string, number | string>;
  status: Generated<DoctorStatus>;
  languages: string[];
  bio: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DoctorSpecializationsTable {
  id: Generated<string>;
  doctor_id: string;
  specialization: string;
}

export interface AvailabilityRulesTable {
  id: Generated<string>;
  doctor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: Generated<number>;
  created_at: Generated<Date>;
}

export interface AvailabilitySlotsTable {
  id: Generated<string>;
  doctor_id: string;
  start_at: Date;
  end_at: Date;
  status: Generated<SlotStatus>;
  held_until: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ConsultationsTable {
  id: Generated<string>;
  slot_id: string;
  patient_id: string;
  doctor_id: string;
  status: Generated<ConsultationStatus>;
  scheduled_at: Date;
  clinical_notes_encrypted: string | null;
  video_room_id: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PrescriptionsTable {
  id: Generated<string>;
  consultation_id: string;
  doctor_id: string;
  patient_id: string;
  version: Generated<number>;
  items_encrypted: string;
  instructions_encrypted: string | null;
  key_version: string;
  pdf_url: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PaymentsTable {
  id: Generated<string>;
  consultation_id: string;
  amount: ColumnType<number, number | string, number | string>;
  currency: Generated<string>;
  status: Generated<PaymentStatus>;
  provider: Generated<string>;
  provider_payment_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PaymentEventsTable {
  id: Generated<string>;
  payment_id: string;
  event_type: string;
  payload: string; // JSON string
  created_at: Generated<Date>;
}

export interface ProcessedWebhooksTable {
  id: Generated<string>;
  provider: string;
  event_id: string;
  processed_at: Generated<Date>;
}

export interface AuditLogsTable {
  id: Generated<string>;
  actor_id: string | null;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  outcome: string;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  prev_hash: string | null;
  hash: string;
  metadata: string | null; // JSON string
  created_at: Generated<Date>;
}

export interface IdempotencyKeysTable {
  id: Generated<string>;
  user_id: string | null;
  scope: string;
  key: string;
  request_fingerprint: string;
  status: Generated<IdempotencyStatus>;
  response_status: number | null;
  response_body: string | null;
  response_headers: string | null; // JSON string
  expires_at: Date;
  created_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: Generated<string>;
  topic: string;
  event_name: string;
  payload: string; // JSON string
  status: Generated<OutboxStatus>;
  retry_count: Generated<number>;
  created_at: Generated<Date>;
  processed_at: Date | null;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  token_hash: string;
  family_id: string;
  is_revoked: Generated<boolean>;
  expires_at: Date;
  created_at: Generated<Date>;
}

export interface MfaFactorsTable {
  id: Generated<string>;
  user_id: string;
  secret_encrypted: string;
  key_version: string;
  is_verified: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface MfaBackupCodesTable {
  id: Generated<string>;
  user_id: string;
  code_hash: string;
  is_used: Generated<boolean>;
  used_at: Date | null;
  created_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  user_roles: UserRolesTable;
  profiles: ProfilesTable;
  doctors: DoctorsTable;
  doctor_specializations: DoctorSpecializationsTable;
  availability_rules: AvailabilityRulesTable;
  availability_slots: AvailabilitySlotsTable;
  consultations: ConsultationsTable;
  prescriptions: PrescriptionsTable;
  payments: PaymentsTable;
  payment_events: PaymentEventsTable;
  processed_webhooks: ProcessedWebhooksTable;
  audit_logs: AuditLogsTable;
  idempotency_keys: IdempotencyKeysTable;
  outbox_events: OutboxEventsTable;
  refresh_tokens: RefreshTokensTable;
  mfa_factors: MfaFactorsTable;
  mfa_backup_codes: MfaBackupCodesTable;
}
