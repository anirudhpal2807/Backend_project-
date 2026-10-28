# Operational Runbook: Stuck Sagas & Slot Hold Reconciliation

## 1. Symptom & Trigger Conditions
- Prometheus Alert: `StuckBookingSagasDetected` (Consultations in `PENDING_PAYMENT` $> 15$ minutes).
- Patient reports booking hold never released after payment browser window was closed.

---

## 2. Diagnosis

### Identify Stuck Bookings
```sql
SELECT c.id, c.status, c.slot_id, c.created_at, s.held_until, s.status AS slot_status
FROM consultations c
JOIN availability_slots s ON c.slot_id = s.id
WHERE c.status = 'PENDING_PAYMENT'
  AND c.created_at < NOW() - INTERVAL '10 minutes';
```

---

## 3. Automated Reconciliation Worker
The background worker automatically runs `SagaReconciliationService` on a 60-second cron interval:
1. Identifies consultations where `status = 'PENDING_PAYMENT'` and `NOW() > held_until`.
2. Queries payment provider (Stripe API) with `consultation_id` to confirm no delayed payment succeeded.
3. If no payment exists:
   - Updates `consultations.status = 'EXPIRED'`.
   - Reverts `availability_slots.status = 'OPEN'`, resets `held_until = NULL`.
   - Publishes `consultation.expired` outbox event.
4. If payment actually succeeded in flight:
   - Recovers saga to `CONFIRMED`.
   - Publishes `booking.confirmed` outbox event.

### Manual Force Recovery (Emergency Override)
If automated reaper is paused:
```sql
BEGIN;
UPDATE availability_slots
SET status = 'OPEN', held_until = NULL
WHERE id IN (
  SELECT slot_id FROM consultations
  WHERE status = 'PENDING_PAYMENT' AND created_at < NOW() - INTERVAL '15 minutes'
);

UPDATE consultations
SET status = 'EXPIRED', updated_at = NOW()
WHERE status = 'PENDING_PAYMENT' AND created_at < NOW() - INTERVAL '15 minutes';
COMMIT;
```
