exports.up = (pgm) => {
  pgm.sql(`
    -- Doctor Verification Status
    CREATE TYPE doctor_status_enum AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

    -- Doctors Table
    CREATE TABLE doctors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      license_number VARCHAR(100) NOT NULL UNIQUE,
      experience_years INT NOT NULL DEFAULT 0,
      consultation_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
      status doctor_status_enum NOT NULL DEFAULT 'PENDING',
      languages TEXT[] NOT NULL DEFAULT '{}',
      bio TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Specializations
    CREATE TABLE doctor_specializations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      specialization VARCHAR(100) NOT NULL,
      UNIQUE(doctor_id, specialization)
    );

    -- Availability Rules (e.g. Every Monday 09:00 - 12:00)
    CREATE TABLE availability_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TIME NOT NULL,
      end_time TIME NOT NULL CHECK (end_time > start_time),
      slot_duration_minutes INT NOT NULL DEFAULT 30,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Slot Status
    CREATE TYPE slot_status_enum AS ENUM ('OPEN', 'HELD', 'BOOKED', 'BLOCKED', 'CANCELLED');

    -- Availability Slots Table with GIST Exclusion Constraint
    CREATE TABLE availability_slots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ NOT NULL CHECK (end_at > start_at),
      status slot_status_enum NOT NULL DEFAULT 'OPEN',
      held_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT no_overlapping_slots_per_doctor
        EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_at, end_at) WITH &&)
        WHERE (status <> 'CANCELLED')
    );

    CREATE INDEX idx_slots_doctor_time ON availability_slots(doctor_id, start_at);
    CREATE INDEX idx_slots_status ON availability_slots(status) WHERE status = 'OPEN';
    CREATE INDEX idx_slots_held_until ON availability_slots(held_until) WHERE status = 'HELD';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS availability_slots;
    DROP TYPE IF EXISTS slot_status_enum;
    DROP TABLE IF EXISTS availability_rules;
    DROP TABLE IF EXISTS doctor_specializations;
    DROP TABLE IF EXISTS doctors;
    DROP TYPE IF EXISTS doctor_status_enum;
  `);
};
