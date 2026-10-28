# Operational Runbook: Database Failover & Connection Saturation

## 1. Alert Triggers
- Prometheus Alert: `PostgreSQLPoolSaturationHigh` (Active connections $> 85\%$ of pool max).
- CloudWatch Alarm: `RDS-HighCPUUtilization` ($> 85\%$ for 5 minutes).

---

## 2. Immediate Actions

### Step 1: Inspect Long-Running Active Queries
```sql
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE state != 'idle' AND (now() - pg_stat_activity.query_start) > INTERVAL '5 seconds'
ORDER BY duration DESC;
```

### Step 2: Terminate Blocking or Runaway Queries
```sql
-- Terminate offending query PID safely
SELECT pg_terminate_backend(<OFFENDING_PID>);
```

### Step 3: Trigger Manual RDS Failover (If Primary AZ Unhealthy)
```bash
aws rds reboot-db-instance \
  --db-instance-identifier amrutam-prod-db \
  --force-failover
```
*The standby replica will be promoted to primary within 60 seconds.*
