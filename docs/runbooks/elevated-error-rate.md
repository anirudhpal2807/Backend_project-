# Operational Runbook: Elevated Error Rate (Multi-Window SLO Burn)

## 1. Alert Triggers
- Critical Alert: `HighErrorBudgetBurnRate1h` (Burn rate $> 14.4\times$).
- High Alert: `APIHigh5xxErrorRate` (5xx rate $> 1\%$ for $> 5$ minutes).

---

## 2. Immediate Diagnostic Procedure

### Step 1: Trace Context Lookup in Centralized Logs (Loki / CloudWatch)
Query errors grouped by `code`:
```bash
aws logs filter-log-events \
  --log-group-name /ecs/amrutam-prod-api \
  --filter-pattern '{ $.level = "error" }' \
  --start-time $(date -d '15 minutes ago' +%s000)
```

### Step 2: Correlate via W3C `traceparent` or `X-Request-Id`
Take any failing `requestId` from the user-facing RFC 7807 problem details response:
```bash
aws logs filter-log-events \
  --log-group-name /ecs/amrutam-prod-api \
  --filter-pattern '{ $.requestId = "req-123456" }'
```

### Step 3: Fast Mitigation Options
- **If caused by newly deployed container version**:
  Trigger immediate ECS rollback:
  ```bash
  aws ecs update-service \
    --cluster amrutam-prod-cluster \
    --service amrutam-api-prod \
    --task-definition amrutam-api-prod:<PREVIOUS_STABLE_REVISION>
  ```
- **If Redis outage causes rate-limiting spike**:
  Confirm fail-open policy is active. If Redis cluster is partitioned, flush DNS cache or failover to standby replica.
