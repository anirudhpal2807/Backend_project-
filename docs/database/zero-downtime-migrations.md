# Zero-Downtime Database Migration Architecture (Expand / Contract Pattern)

## 1. Principles & Zero-Downtime Guarantees

In high-throughput healthcare platforms, database schema changes must never cause table locks, blocking I/O, or API downtime. Amrutam enforces the **Expand and Contract (Parallel Run)** migration pattern across all releases.

### Core Rules:
1. **Never rename or drop an active column in a single release.**
2. **Every migration must be backward-compatible with the currently running application version ($N-1$).**
3. **DDL lock timeouts are enforced (`SET lock_timeout = '2000ms'`)** to fail fast rather than queuing locks behind long-running queries.
4. **Index creation is always non-blocking (`CREATE INDEX CONCURRENTLY`)**.
5. **Pre-rollout execution**: Migrations execute in a dedicated ECS Fargate task *before* the application container rolling update begins.

---

## 2. The 4-Phase Expand/Contract Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant DDL as Pre-Rollout Migrator
    participant OldApp as App Version N (Running)
    participant NewApp as App Version N+1 (Deploying)
    participant DB as PostgreSQL 16

    Note over DDL,DB: Phase 1: EXPAND (Additive Changes)
    DDL->>DB: Add new column (nullable or default) & backfill trigger
    Note over OldApp,DB: App N continues reading/writing old column uninterrupted

    Note over NewApp,DB: Phase 2: DUAL WRITE / ADAPT
    NewApp->>DB: Writes to BOTH old and new columns, reads from new
    Note over DDL,DB: Phase 3: BACKFILL
    DDL->>DB: Background batch worker backfills legacy rows (low batch size)

    Note over NewApp,DB: Phase 4: CONTRACT (Release N+2)
    Note over NewApp,DB: All traffic uses new column; dual write removed
    DDL->>DB: Drop trigger & drop old column safely
```

---

## 3. Concrete Production Example: Migrating Patient Phone Number Format

### Objective:
Migrate `profiles.phone` (raw VARCHAR) to E.164 normalized format stored in `profiles.phone_e164` with unique constraint.

### Step 1: Release $N$ — Expand (Additive Migration)
```sql
-- Migration 010_expand_patient_phone.js
-- 1. Set strict lock timeout to avoid queuing behind transactions
SET lock_timeout = '2s';

-- 2. Add nullable new column (Instant metadata change, zero lock)
ALTER TABLE profiles ADD COLUMN phone_e164 VARCHAR(32);

-- 3. Add dual-write synchronization trigger to maintain parity for legacy writes
CREATE OR REPLACE FUNCTION sync_profiles_phone_e164()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone_e164 IS NULL THEN
    NEW.phone_e164 := regexp_replace(NEW.phone, '[^0-9+]', '', 'g');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_phone_e164
BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION sync_profiles_phone_e164();
```

### Step 2: Release $N+1$ — Application Transition
- Application writes to `phone_e164` directly and reads from `COALESCE(phone_e164, phone)`.
- Background reconciliation job iterates over unpopulated rows in batches of 500:
```sql
UPDATE profiles
SET phone_e164 = regexp_replace(phone, '[^0-9+]', '', 'g')
WHERE id IN (
  SELECT id FROM profiles
  WHERE phone_e164 IS NULL AND phone IS NOT NULL
  LIMIT 500
  FOR UPDATE SKIP LOCKED
);
```

### Step 3: Add Non-Blocking Unique Index
Once backfill reaches 100%:
```sql
-- Create index concurrently without blocking reads or writes
CREATE UNIQUE INDEX CONCURRENTLY idx_profiles_phone_e164_unique
ON profiles (phone_e164)
WHERE phone_e164 IS NOT NULL;
```

### Step 4: Release $N+2$ — Contract (Cleanup)
- Code referencing legacy `phone` column is completely removed.
- Final cleanup migration runs:
```sql
SET lock_timeout = '2s';
DROP TRIGGER IF EXISTS trg_sync_phone_e164 ON profiles;
DROP FUNCTION IF EXISTS sync_profiles_phone_e164();
ALTER TABLE profiles DROP COLUMN phone;
```

---

## 4. Automation & CI/CD Guardrails

1. **Pre-Deployment Check**: Every PR runs `node-pg-migrate` against a disposable testcontainer to ensure DDL executes within 3 seconds.
2. **Safe Rollback**: Because each expand step is strictly backward-compatible, rolling back application code from $N+1$ to $N$ requires **zero database rollbacks** and causes zero application errors.
