# Operational Runbook: Queue Backlog & Dead Letter Queue (DLQ) Triage

## 1. Symptom & Alert Triggers
- Prometheus Alert: `DLQGrowthDetected` (DLQ depth $> 0$ for $> 5$ minutes).
- Prometheus Alert: `BullMQQueueLagHigh` (Pending outbox events $> 1000$ for $> 10$ minutes).

---

## 2. Immediate Diagnostic Steps

### Check Outbox Events Status in Database
```sql
SELECT status, count(*), min(created_at) AS oldest_pending
FROM outbox_events
GROUP BY status;
```

### Inspect Recent DLQ Failures
```sql
SELECT id, topic, event_name, retry_count, payload
FROM outbox_events
WHERE status = 'DEAD_LETTER' OR status = 'FAILED'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 3. Mitigation & Remediation Procedures

### Case A: Downstream Third-Party Outage (e.g., Daily.co / Stripe / SendGrid)
1. Verify downstream provider status at their public status page.
2. If downstream is degraded, worker circuit breakers have tripped (`CIRCUIT_OPEN`).
3. Keep events in `PENDING` or `FAILED`. Do NOT flush queue.
4. Once downstream provider recovers, trigger batch redelivery:
```sql
UPDATE outbox_events
SET status = 'PENDING', retry_count = 0
WHERE status = 'FAILED' AND created_at > NOW() - INTERVAL '6 hours';
```

### Case B: Poison Pill / Malformed Payload
1. Identify the offending event ID from the query above.
2. Inspect `payload` JSON. If data is corrupt or unrecoverable, archive and mark as dead-letter:
```sql
UPDATE outbox_events
SET status = 'DEAD_LETTER'
WHERE id = '<OFFENDING_EVENT_ID>';
```
3. Document root cause and log Jira bug for domain validation fix.
