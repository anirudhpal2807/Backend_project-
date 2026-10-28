# Service Level Objectives (SLO), SLIs, and Error Budget Policy

## 1. Executive Summary and Philosophy

The Amrutam Telemedicine Platform operates as a Tier-1 healthcare delivery service. System unavailability or elevated latency directly impacts clinical care, physician consultations, and timely prescription dispatch.

This policy defines our Service Level Indicators (SLIs), Service Level Objectives (SLOs), and Error Budget governance in strict alignment with Google Site Reliability Engineering (SRE) best practices.

---

## 2. Core Service Level Objectives (SLOs)

| Metric | Target (SLO) | Measurement Window | Allowed Error Budget | SLI Formulation |
|---|---|---|---|---|
| **API Availability** | **99.95%** | Rolling 30 Days | **0.05%** (~21.6 minutes/month) | `sum(http_requests{status!~"5.."}) / sum(http_requests)` |
| **Read Latency (P95)** | **< 200 ms** | Rolling 30 Days | 5.0% of requests | `histogram_quantile(0.95, http_duration{method="GET"}) < 0.200s` |
| **Write Latency (P95)**| **< 500 ms** | Rolling 30 Days | 5.0% of requests | `histogram_quantile(0.95, http_duration{method=~"POST\|PUT\|PATCH"}) < 0.500s` |
| **Zero Double-Booking**| **100.00%** | Absolute | **0 Incidents** | Database exclusion constraint (`EXCLUDE USING gist`) violations |
| **Data Immutability**  | **100.00%** | Absolute | **0 Tampered Rows**| `audit_logs` cryptographic SHA-256 hash-chain verification |

---

## 3. Multi-Window Multi-Burn-Rate Alerting Strategy

Rather than relying on single-threshold alerts that produce false positives or wake engineers for brief spikes, we employ a **multi-window burn-rate strategy**:

```
Burn Rate (B) = (% of budget consumed) / (% of period elapsed)
```

| Alert Tier | Lookback Window | Burn Rate | % Budget Consumed | Notification Channel | Required Action |
|---|---|---|---|---|---|
| **Critical Page (P1)** | **1 Hour** | **14.4x** | 2.0% in 1 hr | PagerDuty / On-Call Voice | Immediate triage within 5 minutes. Incident Commander activated. |
| **High Page (P2)**     | **6 Hours** | **6.0x** | 5.0% in 6 hrs | PagerDuty / On-Call Push | Triage within 15 minutes. Assess recent deployments. |
| **Warning (P3)**       | **3 Days** | **1.0x** | 10.0% in 3 days | Slack #alerts-eng-ops | Next business day review. Create bug ticket. |

---

## 4. Error Budget Governance and Consequences

The 30-day rolling error budget is our shared engineering currency:

### Green State (Budget Remaining > 20%)
- Feature releases and deployments proceed normally.
- A/B experiments and architecture migrations are permitted.

### Yellow State (Budget Remaining 0% - 20%)
- Weekly reliability standup reviews recent incidents.
- No high-risk production infrastructure changes without VP Engineering approval.

### Red State (Budget Exhausted <= 0%)
- **Automatic Deployment Freeze**: Only P0 security patches and reliability fixes may be deployed.
- **100% Reliability Focus**: All feature sprint work is paused. The entire team prioritizes bug fixes, query tuning, and resiliency improvements until the rolling 30-day availability recovers above 99.95%.

---

## 5. Hop-by-Hop Latency Budgets (Write Flow)

Under 150 peak write TPS, our 500ms P95 budget is budgeted across sub-components:

| Hop / Operation | Target Budget (P95) |
|---|---|
| TLS Termination & ALB | 15 ms |
| Fastify Request Pipeline & Body Parsing | 10 ms |
| JWT Verification & Role Assertion | 5 ms |
| Redis Idempotency Lock (`SET NX`) | 5 ms |
| PostgreSQL Atomic Transaction (`FOR UPDATE`, slot hold, outbox write) | 80 ms |
| Application Response Serialization | 10 ms |
| Network Egress Buffer | 15 ms |
| **Total Hop Budget** | **140 ms** (Well within 500 ms ceiling) |
