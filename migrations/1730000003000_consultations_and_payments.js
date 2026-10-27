exports.up = (pgm) => {
  pgm.sql(`
    -- Consultation Status
    CREATE TYPE consultation_status_enum AS ENUM (
      'PENDING_PAYMENT',
      'CONFIRMED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'EXPIRED',
      'NO_SHOW',
      'REFUNDED'
    );

    -- Consultations Table
    CREATE TABLE consultations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slot_id UUID NOT NULL REFERENCES availability_slots(id),
      patient_id UUID NOT NULL REFERENCES users(id),
      doctor_id UUID NOT NULL REFERENCES doctors(id),
      status consultation_status_enum NOT NULL DEFAULT 'PENDING_PAYMENT',
      scheduled_at TIMESTAMPTZ NOT NULL,
      clinical_notes_encrypted TEXT,
      video_room_id VARCHAR(255),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- CRITICAL ANTI-DOUBLE-BOOKING GUARD:
    -- Partial unique index guarantees that only ONE active consultation can exist for any slot
    CREATE UNIQUE INDEX uq_consultation_active_slot
      ON consultations (slot_id)
      WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED');

    CREATE INDEX idx_consultations_patient ON consultations(patient_id, scheduled_at DESC);
    CREATE INDEX idx_consultations_doctor ON consultations(doctor_id, scheduled_at DESC);
    CREATE INDEX idx_consultations_status ON consultations(status);

    -- Payment Status
    CREATE TYPE payment_status_enum AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

    -- Payments Table
    CREATE TABLE payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
      amount NUMERIC(10, 2) NOT NULL,
      currency VARCHAR(3) NOT NULL DEFAULT 'INR',
      status payment_status_enum NOT NULL DEFAULT 'PENDING',
      provider VARCHAR(50) NOT NULL DEFAULT 'mock_provider',
      provider_payment_id VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE payment_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Processed Webhooks Table (for replay protection and idempotency)
    CREATE TABLE processed_webhooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider VARCHAR(50) NOT NULL,
      event_id VARCHAR(255) NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, event_id)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS processed_webhooks;
    DROP TABLE IF EXISTS payment_events;
    DROP TABLE IF EXISTS payments;
    DROP TYPE IF EXISTS payment_status_enum;
    DROP TABLE IF EXISTS consultations;
    DROP TYPE IF EXISTS consultation_status_enum;
  `);
};
