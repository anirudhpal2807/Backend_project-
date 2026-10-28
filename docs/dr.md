# Disaster Recovery & Business Continuity Plan (BCP / DRP)

## 1. Objectives & RPO / RTO Guarantees

| Objective | Target | Mechanism |
|---|---|---|
| **Recovery Point Objective (RPO)** | **$\le 5$ minutes** | PostgreSQL continuous WAL archiving to S3 + 35-day RDS PITR |
| **Recovery Time Objective (RTO)** | **$\le 30$ minutes** | Multi-AZ automated RDS failover (< 60s) + Terraform ECS recreation |
| **Data Retention** | **7 Years** | WORM S3 Object Lock for immutable audit logs & prescriptions |

---

## 2. Backup Architecture

1. **RDS Continuous Backups (Primary Region: `ap-south-1` Mumbai)**:
   - Automated continuous snapshots with 5-minute transaction granularity.
   - 35-day continuous retention window.
   - Managed KMS CMK encryption at rest.
2. **Cross-Region Snapshot Replication (`ap-southeast-1` Singapore)**:
   - Daily automated snapshot copy executed at 21:00 UTC.
   - Re-encrypted using destination region KMS CMK.
3. **Application State & Cache (Redis 7)**:
   - Daily automated RDB snapshots retained for 7 days.
   - Ephemeral cache data regenerates automatically via database cache-aside pattern.

---

## 3. Disaster Recovery Restoration Runbook

### Scenario A: Primary RDS Failure (Single-AZ Outage)
*Action is 100% automated by AWS RDS Multi-AZ.*
1. Primary instance experiences hardware, network, or OS failure.
2. AWS automatically switches CNAME to synchronous standby replica in secondary AZ.
3. Active connection pool in API services detects broken connection, exhausts 5s timeout, and reconnects to new primary.
4. Total downtime: **40 to 90 seconds**. Zero data loss.

### Scenario B: Catastrophic Region Outage (Failover to `ap-southeast-1`)

#### Step 1: Provision Secondary Infrastructure
```bash
cd infra/terraform
terraform init -backend-config="region=ap-southeast-1"
terraform apply -var-file="environments/prod-dr.tfvars" -auto-approve
```

#### Step 2: Restore RDS from Replicated Snapshot
```bash
# Locate latest replicated snapshot
SNAPSHOT_ARN=$(aws rds describe-db-snapshots \
  --region ap-southeast-1 \
  --db-instance-identifier amrutam-prod-db \
  --query "reverse(sort_by(DBSnapshots, &SnapshotCreateTime))[0].DBSnapshotArn" \
  --output text)

# Restore database instance
aws rds restore-db-instance-from-db-snapshot \
  --region ap-southeast-1 \
  --db-instance-identifier amrutam-prod-db-restored \
  --db-snapshot-identifier "$SNAPSHOT_ARN" \
  --db-instance-class db.m6g.2xlarge \
  --multi-az \
  --kms-key-id "arn:aws:kms:ap-southeast-1:123456789012:key/dr-key"
```

#### Step 3: Run Database Migrations
```bash
DATABASE_URL="postgres://amrutam_master:password@$RESTORED_ENDPOINT:5432/amrutam_prod" npm run migrate:up
```

#### Step 4: Route DNS via Route53 Failover
```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789 \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "api.amrutam.global",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "ZDRALBZONE",
          "DNSName": "amrutam-dr-alb-1234.ap-southeast-1.elb.amazonaws.com",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

---

## 4. Quarterly DR Drill Checklist

- [ ] Verify cross-region snapshot replication status within the last 24 hours.
- [ ] Spin up isolated test environment from snapshot in `ap-southeast-1`.
- [ ] Execute `tests/unit/chaos-resilience.spec.ts` against restored instance.
- [ ] Verify audit log cryptographic hash chain continuity: `GET /api/v1/audit/verify`.
- [ ] Measure total elapsed restoration time (RTO target $< 30$ min).
- [ ] Record drill metrics and sign off in engineering compliance log.
