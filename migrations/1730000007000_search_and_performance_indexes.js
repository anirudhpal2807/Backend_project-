exports.up = (pgm) => {
  pgm.sql(`
    -- Trigram index for fuzzy doctor specialization search
    CREATE INDEX idx_doctor_specializations_trgm
      ON doctor_specializations USING gin (specialization gin_trgm_ops);

    -- Composite index for rapid availability lookups by doctor and start range
    CREATE INDEX idx_slots_doctor_range_status
      ON availability_slots (doctor_id, start_at, end_at, status);

    -- Composite index for fast consultation history querying
    CREATE INDEX idx_consultations_patient_status
      ON consultations (patient_id, status, scheduled_at DESC);

    CREATE INDEX idx_consultations_doctor_status
      ON consultations (doctor_id, status, scheduled_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_consultations_doctor_status;
    DROP INDEX IF EXISTS idx_consultations_patient_status;
    DROP INDEX IF EXISTS idx_slots_doctor_range_status;
    DROP INDEX IF EXISTS idx_doctor_specializations_trgm;
  `);
};
