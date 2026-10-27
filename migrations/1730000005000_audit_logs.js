exports.up = (pgm) => {
  pgm.sql(`
    -- Audit Logs Table (Append-only, Cryptographic Hash Chain)
    CREATE TABLE audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id UUID,
      actor_role VARCHAR(50) NOT NULL,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(100) NOT NULL,
      resource_id VARCHAR(255) NOT NULL,
      outcome VARCHAR(50) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      request_id VARCHAR(100),
      prev_hash VARCHAR(64),
      hash VARCHAR(64) NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id, created_at DESC);
    CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
    CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

    -- Immutability Enforcement Trigger:
    -- Absolutely no UPDATE or DELETE is permitted on audit_logs
    CREATE OR REPLACE FUNCTION prevent_audit_logs_tampering()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Audit logs are immutable. UPDATE and DELETE operations are forbidden.';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_protect_audit_logs
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_logs_tampering();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_protect_audit_logs ON audit_logs;
    DROP FUNCTION IF EXISTS prevent_audit_logs_tampering();
    DROP TABLE IF EXISTS audit_logs;
  `);
};
