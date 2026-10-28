exports.up = (pgm) => {
  pgm.sql(`
    -- Analytics Daily Rollups Table (Pre-aggregated rollups for O(1) analytics queries)
    CREATE TABLE IF NOT EXISTS analytics_daily_rollups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      date DATE NOT NULL,
      dimension VARCHAR(50) NOT NULL DEFAULT 'TOTAL',
      dimension_value VARCHAR(100) NOT NULL DEFAULT 'ALL',
      total_slots INT NOT NULL DEFAULT 0,
      booked_slots INT NOT NULL DEFAULT 0,
      completed_consultations INT NOT NULL DEFAULT 0,
      cancelled_consultations INT NOT NULL DEFAULT 0,
      no_show_consultations INT NOT NULL DEFAULT 0,
      total_revenue_inr NUMERIC(14, 2) NOT NULL DEFAULT 0,
      refunded_amount_inr NUMERIC(14, 2) NOT NULL DEFAULT 0,
      utilization_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_analytics_date_dimension UNIQUE (date, dimension, dimension_value)
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_date ON analytics_daily_rollups(date DESC);
    CREATE INDEX IF NOT EXISTS idx_analytics_dimension ON analytics_daily_rollups(dimension, dimension_value);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS analytics_daily_rollups;
  `);
};
