exports.up = (pgm) => {
  pgm.sql(`
    -- Idempotency Status
    CREATE TYPE idempotency_status_enum AS ENUM ('IN_FLIGHT', 'COMPLETED', 'FAILED');

    -- Idempotency Keys Table
    CREATE TABLE idempotency_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      scope VARCHAR(100) NOT NULL,
      key VARCHAR(255) NOT NULL,
      request_fingerprint VARCHAR(64) NOT NULL,
      status idempotency_status_enum NOT NULL DEFAULT 'IN_FLIGHT',
      response_status INT,
      response_body TEXT,
      response_headers JSONB,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, scope, key)
    );

    CREATE INDEX idx_idempotency_expires_at ON idempotency_keys(expires_at);

    -- Outbox Status
    CREATE TYPE outbox_status_enum AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

    -- Transactional Outbox Events Table
    CREATE TABLE outbox_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      topic VARCHAR(100) NOT NULL,
      event_name VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL,
      status outbox_status_enum NOT NULL DEFAULT 'PENDING',
      retry_count INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );

    CREATE INDEX idx_outbox_pending ON outbox_events(status, created_at) WHERE status = 'PENDING';

    -- Rotating Refresh Tokens (Hashed, Token Family Tracking)
    CREATE TABLE refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      family_id UUID NOT NULL,
      is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);
    CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

    -- MFA TOTP Factors
    CREATE TABLE mfa_factors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      secret_encrypted TEXT NOT NULL,
      key_version VARCHAR(50) NOT NULL DEFAULT 'v1',
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- MFA Single-Use Backup Codes (Hashed)
    CREATE TABLE mfa_backup_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash VARCHAR(64) NOT NULL,
      is_used BOOLEAN NOT NULL DEFAULT FALSE,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_mfa_backup_codes_user ON mfa_backup_codes(user_id) WHERE is_used = FALSE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS mfa_backup_codes;
    DROP TABLE IF EXISTS mfa_factors;
    DROP TABLE IF EXISTS refresh_tokens;
    DROP TABLE IF EXISTS outbox_events;
    DROP TYPE IF EXISTS outbox_status_enum;
    DROP TABLE IF EXISTS idempotency_keys;
    DROP TYPE IF EXISTS idempotency_status_enum;
  `);
};
