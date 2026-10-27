exports.up = (pgm) => {
  pgm.sql(`
    -- Prescriptions Table (Versioned, Encrypted clinical data)
    CREATE TABLE prescriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      consultation_id UUID NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
      doctor_id UUID NOT NULL REFERENCES doctors(id),
      patient_id UUID NOT NULL REFERENCES users(id),
      version INT NOT NULL DEFAULT 1,
      items_encrypted TEXT NOT NULL,
      instructions_encrypted TEXT,
      key_version VARCHAR(50) NOT NULL DEFAULT 'v1',
      pdf_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (consultation_id, version)
    );

    CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);
    CREATE INDEX idx_prescriptions_consultation ON prescriptions(consultation_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS prescriptions;
  `);
};
