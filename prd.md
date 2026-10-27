# PRD — Amrutam Telemedicine Backend

| Field | Value |
|---|---|
| Document owner | Project lead (human) |
| Status | Approved baseline v1.0 |
| Last updated | 2026-10-27 |
| Time budget | 4–5 days |
| Source | Backend Developer Assignment (PDF) |

> This document is the source of truth for **what** we build and **why**. `prompt.md` defines **how** the agent works. `tasks.md` tracks **what is done**. If this PRD and any other file disagree, the PRD wins unless an ADR in `docs/adr/` says otherwise.

---

## 1. Purpose and Goals

Build a production-grade backend for Amrutam's telemedicine platform that lets patients find doctors, book consultations, attend them, and receive prescriptions, while giving admins compliance and analytics visibility.

The system is evaluated on **scalability, reliability, security and observability**, not just feature coverage. Every design choice must be defensible in the architecture doc.

### 1.1 Goals
1. Implement the six core workflows end to end (Section 4).
2. Meet the stated NFRs (Section 5) and *prove* them with load tests and dashboards.
3. Ship all seven deliverables (Section 9), including infra as code, CI/CD, threat model and a 5-minute demo.
4. Make double-booking and duplicate-write bugs **impossible by construction** (DB constraints plus idempotency), not just unlikely.

### 1.2 Non-Goals (explicitly out of scope)
- Real video/audio streaming (we model session metadata only; provider is abstracted behind an interface).
- Real payment gateway integration (we build a provider interface plus a mock provider with signed webhooks).
- Frontend / mobile apps.
- Multi-region active-active. (We design for multi-AZ and *document* the multi-region DR path.)
- Real SMS/email delivery (notification provider interface plus a log/mock adapter).
- Regulatory certification (HIPAA/DPDP). We align controls and document gaps, but do not claim compliance.

---

## 2. Personas and Roles

| Role | Description | Key capabilities |
|---|---|---|
| `PATIENT` | End user seeking care | Register, MFA, search doctors, book/cancel/reschedule, view own consultations and prescriptions |
| `DOCTOR` | Verified practitioner | Manage availability, view own consultations, start/complete consultations, issue prescriptions |
| `ADMIN` | Platform operator | Verify doctors, manage users, view analytics, view audit logs |
| `AUDITOR` | Read-only compliance role | Read audit logs and compliance reports only; no PHI payload access |
| `SYSTEM` | Internal workers | Expire holds, process webhooks, run reconciliation (never exposed via API) |

RBAC is enforced server-side per endpoint, plus **resource-level ownership checks** (a patient can only read their own consultation; a doctor only their own patients' consultations).

---

## 3. Assumptions and Key Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **TypeScript on Node.js 20 + NestJS (Fastify adapter)** | Built-in DI/modules satisfy "modular services with DI"; Fastify gives low overhead |
| D2 | **Modular monolith + separate worker process** from the same codebase | Faster to deliver in 4–5 days than microservices; module boundaries allow later extraction; workers handle async jobs |
| D3 | **PostgreSQL 16** (system of record), **Redis 7** (cache, rate limit, locks, BullMQ) | Matches guideline; Redis is optional but needed for p95 targets |
| D4 | **REST + OpenAPI 3.1**, URL-versioned `/api/v1` | Simple, testable, contract-first |
| D5 | **Raw SQL migrations** (node-pg-migrate) with a typed query layer (Kysely) | Full control over partitioning, partial indexes, triggers and exclusion constraints, which ORMs handle poorly |
| D6 | **Orchestrated saga** for booking (slot hold → payment → confirm) with transactional outbox | Reliable cross-step consistency without distributed transactions |
| D7 | **Envelope encryption** for PHI fields via a `KeyManagementService` interface (local-KMS adapter for dev, AWS KMS adapter documented) | Satisfies encryption and key-rotation requirements without cloud lock-in during development |
| D8 | **Infra:** Docker, docker-compose (local), Terraform (AWS: VPC, RDS, ElastiCache, ECS Fargate/EKS, ALB, KMS, Secrets Manager), GitHub Actions | Containerized deployment plus IaC deliverable |
| D9 | **Observability:** OpenTelemetry → Prometheus (metrics), Loki (logs), Tempo/Jaeger (traces), Grafana | Open standard; runs locally via compose |

Any change to D1–D9 requires an ADR.

---

## 4. Functional Requirements

Priorities: **P0** = must ship (fail risk), **P1** = should ship, **P2** = bonus.

### 4.1 User Lifecycle: Auth and Roles (P0)
- **FR-AUTH-1** Register with email and password (Argon2id hashing; password policy; breached-password check optional).
- **FR-AUTH-2** Login returns short-lived access JWT (15 min) and rotating refresh token (7 days, stored hashed, **reuse detection revokes the whole token family**).
- **FR-AUTH-3** **MFA (TOTP, RFC 6238)**: enroll, verify, disable; 10 single-use backup codes (hashed). MFA is **mandatory for `DOCTOR`, `ADMIN`, `AUDITOR`** and optional for `PATIENT`.
- **FR-AUTH-4** Logout and revoke-all-sessions.
- **FR-AUTH-5** Account lockout / progressive delay after repeated failures; generic error messages (no user enumeration).
- **FR-AUTH-6** Email verification and password reset flow (token-based, single use, expiring; delivery via notification interface).
- **FR-USER-1** Profile CRUD (`profiles`): name, DOB, gender, phone, address; PII encrypted at field level where classified Confidential or higher.
- **FR-USER-2** Admin can deactivate users and change roles (every action audited).
- **FR-DOC-1** Doctor onboarding: specialization(s), qualifications, license number, experience, consultation fee, languages. Status: `PENDING → VERIFIED | REJECTED | SUSPENDED` (admin action). Only `VERIFIED` doctors are searchable and bookable.

### 4.2 Doctor Availability and Booking (P0)
- **FR-AVAIL-1** Doctors create availability as recurring rules and/or explicit slots; the system materializes concrete `availability_slots` (fixed duration, e.g. 15/30 min) up to a rolling horizon (default 30 days) via a scheduled job.
- **FR-AVAIL-2** Slot overlap for the same doctor is rejected **by the database** (exclusion constraint on `tstzrange`).
- **FR-AVAIL-3** Doctor can block/unblock slots. Blocking a slot with a confirmed booking is rejected unless the doctor cancels the consultation first.
- **FR-BOOK-1** Patient books an `OPEN` slot. **Exactly one** booking may succeed per slot under any concurrency (see NFR-CONC).
- **FR-BOOK-2** Booking creates a time-limited **hold** (default 10 min) → payment → **confirmation** (saga, Section 6.4). Unpaid holds expire automatically and release the slot.
- **FR-BOOK-3** Cancel / reschedule with policy: free cancellation until T-X hours; later cancellations trigger partial or no refund (configurable).
- **FR-BOOK-4** All booking/cancel/pay endpoints require an `Idempotency-Key` header.
- **FR-BOOK-5** A patient cannot hold overlapping slots across different doctors (checked in the same transaction).
- **FR-BOOK-6** All timestamps stored in UTC (`timestamptz`); API accepts and returns ISO-8601; doctor timezone stored on profile.

### 4.3 Consultation Lifecycle and Prescriptions (P0)
- **FR-CONS-1** State machine: `PENDING_PAYMENT → CONFIRMED → IN_PROGRESS → COMPLETED`; terminal side states: `CANCELLED`, `EXPIRED`, `NO_SHOW`, `REFUNDED`. Illegal transitions return `409` and are impossible at the DB level (transition table / check in a single transition function).
- **FR-CONS-2** Doctor starts and completes consultation, adds clinical notes (encrypted).
- **FR-CONS-3** Session metadata (provider, room id, join tokens) generated via a `VideoProvider` interface (mock adapter).
- **FR-RX-1** Only the consultation's doctor can create a prescription, only when state is `IN_PROGRESS` or `COMPLETED`, once per consultation, with versioning (amendments create a new version; old versions retained).
- **FR-RX-2** Prescription items (drug, dose, frequency, duration, instructions) stored **encrypted at rest**; patient and issuing doctor can read; admins cannot read content (only metadata).
- **FR-RX-3** Prescription PDF generation as an **async job** with signed, expiring download URL (P1).

### 4.4 Search and Filtering (P0)
- **FR-SRCH-1** Search doctors by name, specialization, language, gender, fee range, rating, availability window (date/time), and consultation mode.
- **FR-SRCH-2** Full-text + fuzzy match using PostgreSQL `tsvector` + `pg_trgm`; keyset (cursor) pagination; stable sort options.
- **FR-SRCH-3** Availability filter returns doctors with at least one `OPEN` slot in the window.
- **FR-SRCH-4** Hot queries are cached in Redis with short TTL and event-based invalidation.

### 4.5 Compliance and Audit Trails (P0)
- **FR-AUD-1** Every security-relevant and PHI-touching action writes an **append-only** `audit_logs` record: actor, role, action, resource type/id, outcome, IP, user-agent, request id, before/after hashes (never raw PHI).
- **FR-AUD-2** Tamper evidence: each record contains `prev_hash` and `hash` (hash chain per partition); DB triggers and revoked privileges block `UPDATE`/`DELETE`.
- **FR-AUD-3** Audit write must be **in the same transaction** as the business change (or via transactional outbox), so no action succeeds without its audit record.
- **FR-AUD-4** Auditor/Admin can query audit logs with filters; a verify endpoint/job validates the hash chain.
- **FR-AUD-5** PHI **read** access is also audited (who viewed which prescription/consultation).
- **FR-AUD-6** Data retention policy and soft-delete/anonymization flow for "right to erasure" (documented; PHI retention rules take precedence).

### 4.6 Admin Analytics (P1)
- **FR-ANA-1** Metrics: daily consultations by status, bookings funnel (held → paid → completed), cancellation/no-show rate, revenue, top specializations, doctor utilization, p50/p95 consultation start delay.
- **FR-ANA-2** Served from **pre-aggregated rollup tables / materialized views** refreshed by async jobs, never by scanning live partitions on request.
- **FR-ANA-3** Date-range and dimension filters; CSV export as async job (P2).

### 4.7 Payments (P0 for saga, mock provider)
- **FR-PAY-1** Create payment intent per consultation (idempotent), mock provider returns a client secret.
- **FR-PAY-2** Webhook endpoint with **HMAC signature verification, timestamp tolerance and replay protection**; processed idempotently by provider event id.
- **FR-PAY-3** Refunds on eligible cancellations; reconciliation job detects payments stuck in intermediate states.

---

## 5. Non-Functional Requirements

### 5.1 Scale and Capacity (derived targets)
- 100k consultations/day ≈ **1.2 writes/s average**; assume **10× peak (≈12 booking flows/s)** plus retries.
- Each booking flow ≈ 6–10 writes → budget for **~150 write TPS** at DB.
- Read:write ≈ 20:1 (search, slot listing, status polling) → design for **~300–500 read RPS** peak; load-test at **2× headroom**.
- Storage: ~100k consultations/day → ~36M rows/year per consultation-class table; audit logs ≈ 5–10 rows per flow → **~200–350M rows/year**. Drives partitioning (Section 6.5).

### 5.2 Targets

| ID | Requirement | Target | Verification |
|---|---|---|---|
| NFR-LAT-R | Read latency | **p95 < 200 ms** | k6 report in `docs/perf/` |
| NFR-LAT-W | Write latency | **p95 < 500 ms** | k6 report |
| NFR-AVAIL | Availability | **99.95%** (≈ 21.9 min downtime/month) | Multi-AZ design, health checks, SLO dashboard and burn-rate alerts |
| NFR-CONC | Concurrency correctness | 0 double-bookings under 1,000 concurrent attempts on one slot | Integration/concurrency test |
| NFR-IDEM | Idempotency | Replayed write returns the **identical** stored response; no duplicate side effects | Integration tests |
| NFR-SEC | Security | No critical findings in dependency/container/IaC scans; OWASP Top 10 mitigated | CI gates, threat model |
| NFR-OBS | Observability | Metrics, logs, traces correlated by trace id; dashboards and alerts as code | Compose stack, screenshots in docs |
| NFR-REL | Reliability | RPO ≤ 5 min, RTO ≤ 30 min | DR doc, restore drill documented |
| NFR-TEST | Quality | ≥ 80% line coverage on domain/service layers; critical paths 100% scenario coverage | CI coverage gate |

### 5.3 Security Requirements
- TLS 1.2+ in transit (terminated at LB; DB/Redis connections TLS-enabled in prod config).
- Encryption at rest (DB/volumes via KMS) plus **application-level field encryption** for PHI/PII (AES-256-GCM, envelope encryption, per-record data key, `key_version` stored for rotation).
- Key rotation: KEK rotation (scheduled) plus lazy re-wrap job for DEKs; JWT signing key rotation via `kid` and JWKS-style key set.
- MFA (TOTP), Argon2id, RBAC plus ownership checks, rate limiting per IP and per account, strict input validation (schema-based, reject unknown fields), parameterized queries only.
- Secrets exclusively from environment variables (`.env.example` committed, real `.env` git-ignored); secret scanning in CI.
- Security headers, CORS allowlist, body size limits, request timeouts, SSRF-safe outbound calls, PHI redaction in logs.
- Dependency, container image and IaC scanning in CI (npm audit/Trivy/Checkov or equivalent) plus SBOM generation.

### 5.4 Data Classification

| Class | Examples | Controls |
|---|---|---|
| **Restricted (PHI)** | Prescriptions, clinical notes, diagnoses | Field-level encryption, access audited, never logged, strict RBAC |
| **Confidential (PII)** | Name, DOB, phone, address, email | Field-level encryption (sensitive subset), masked in logs, encrypted backups |
| **Internal** | Slots, consultation metadata, analytics | Standard access control |
| **Public** | Verified doctor public profile (name, specialization, fee) | Cacheable |
| **Secrets** | Passwords, TOTP seeds, tokens, API keys | Hashed (Argon2id / SHA-256 for tokens) or encrypted; never logged |

---

## 6. Technical Requirements (summary; full detail goes in `docs/architecture.md`)

### 6.1 Architecture Style
Modular monolith (`api` process) + `worker` process (BullMQ) sharing one codebase and one Postgres. Each module owns its tables and exposes a service interface; no cross-module table access (go through the service/DI boundary). Stateless API → horizontally scalable behind a load balancer.

### 6.2 Core Data Model
Required tables: `users, profiles, doctors, availability_slots, consultations, prescriptions, payments, audit_logs`.
Supporting tables: `roles/user_roles`, `mfa_factors`, `mfa_backup_codes`, `refresh_tokens`, `idempotency_keys`, `outbox_events`, `doctor_specializations`, `availability_rules`, `payment_events`, `analytics_daily_rollups`, `encryption_keys` (metadata only), `processed_webhooks`.

Critical constraints (must exist in migrations):
- `availability_slots`: `EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_at,end_at) WITH &&) WHERE (status <> 'CANCELLED')`.
- `consultations`: **partial unique index** on `(slot_id) WHERE status IN ('PENDING_PAYMENT','CONFIRMED','IN_PROGRESS','COMPLETED')`. This is the final guard against double-booking.
- `idempotency_keys`: unique `(user_id, scope, key)` with request fingerprint, status, stored response.
- `audit_logs`: no UPDATE/DELETE privilege for the app role; trigger as defense in depth.
- `payments`: unique `(provider, provider_payment_id)`; unique `(consultation_id, purpose)`.

### 6.3 Concurrency and Caching
- Booking path: single transaction, `SELECT … FOR UPDATE SKIP LOCKED`/conditional `UPDATE … WHERE status='OPEN'` on the slot; DB constraint is the source of truth; Redis lock is an optimization only, never the correctness mechanism.
- Optimistic locking (`version` column) on consultations and prescriptions.
- Cache-aside for doctor search results and doctor profiles (TTL 30–120 s, jittered), **never cache slot-level availability as authoritative** (short TTL and revalidate in transaction); stampede protection via single-flight; cache invalidation through outbox events.

### 6.4 Booking Saga (orchestrated, with outbox)
1. `HOLD`: tx { validate slot OPEN → mark `HELD` + `held_until` → insert consultation `PENDING_PAYMENT` → audit → outbox event }.
2. `PAY`: create payment intent (idempotent with provider).
3. `CONFIRM`: on verified `payment.succeeded` webhook → tx { consultation `CONFIRMED`, slot `BOOKED`, audit, outbox `booking.confirmed` }.
4. **Compensation:** payment failed or hold expired → consultation `EXPIRED/CANCELLED`, slot back to `OPEN`, release; refund if payment captured late (late-success webhook after expiry triggers auto-refund path).
5. A **reconciliation job** repairs stuck sagas (state older than threshold).

### 6.5 Data Partitioning
- `consultations`: **range by `scheduled_at` (monthly)**; `audit_logs`: **range by `created_at` (monthly)**; `availability_slots`: range by `start_at` (monthly, retention drop of old partitions); `outbox_events` / `idempotency_keys`: time-partitioned with TTL purge by dropping partitions.
- Automated partition creation/maintenance job (pg_partman or custom) and documented archival to cold storage.
- Hash partitioning of `doctor_id` documented as the future scale-out path; sharding strategy discussed in architecture doc.

### 6.6 Retry and Backoff
- Outbound/idempotent calls: exponential backoff with **full jitter** (base 100 ms, cap 10 s, max 5 attempts), per-call timeouts, **circuit breaker** around payment/video/notification providers.
- Queue jobs: BullMQ attempts with exponential backoff, **dead-letter queue**, poison-message handling, job idempotency keys.
- DB: retry on serialization failure / deadlock (bounded, 3 attempts); never retry non-idempotent operations without a key.
- Clients receive `Retry-After` on 429/503.

### 6.7 Backup and DR
- PostgreSQL PITR (continuous WAL archiving) + daily snapshots; cross-region snapshot copy; Redis treated as rebuildable (no authoritative data).
- Targets: **RPO ≤ 5 min, RTO ≤ 30 min**; quarterly restore drill; runbook with exact commands in `docs/dr.md`.
- Multi-AZ RDS with automatic failover; app tolerates 30–60 s failover via retry/backoff and connection pool recovery.

### 6.8 Observability
- **Metrics (RED + USE + business):** request rate, errors, duration histograms per route; DB pool saturation; queue depth/lag; cache hit ratio; bookings/min; saga failures; double-booking-prevented counter.
- **Logs:** structured JSON (pino), `trace_id`/`request_id` on every line, PHI redaction, log levels via env.
- **Traces:** OpenTelemetry auto + manual spans across API → DB → queue → worker.
- **SLOs:** availability 99.95%, read p95 < 200 ms, write p95 < 500 ms; multi-window burn-rate alerts; dashboards and alert rules stored as code.
- Health endpoints: `/health/live`, `/health/ready` (dependency checks), `/metrics`.

---

## 7. API Principles
- REST, JSON, `/api/v1`, OpenAPI 3.1 file generated and committed (`openapi/openapi.yaml`), validated in CI (lint plus contract tests).
- Consistent error envelope (RFC 7807 `application/problem+json`) with stable error codes.
- Cursor pagination, filtering and sorting conventions documented.
- `Idempotency-Key` required on all non-safe mutating endpoints that create resources or move money/state; semantics: same key + same body → replay stored response (`Idempotent-Replayed: true`); same key + different body → `422`; in-flight duplicate → `409` with `Retry-After`.
- Rate limits: global per IP, stricter on auth endpoints, per-user on booking; `429` plus headers.
- Every response carries `X-Request-Id`.

---

## 8. Constraints and Risks

| Risk | Impact | Mitigation |
|---|---|---|
| 4–5 day timeline | Incomplete deliverables | Strict priority order (P0 → P1 → P2); vertical slices; modular monolith |
| Double-booking bug | **Automatic fail** | DB-level constraints, concurrency tests in CI |
| Missing idempotency | **Automatic fail** | Idempotency middleware built in Phase 3 before any write endpoint |
| Critical security gap | **Automatic fail** | Security tasks are P0 and gate the release; scans in CI |
| Over-engineering | Time loss | Document future work instead of building it |
| Local env differences | Demo failure | Everything runs via `docker compose up`; seed script |

---

## 9. Deliverables

| # | Deliverable | Location | Acceptance |
|---|---|---|---|
| 1 | Git repo with code and infra | `/` (`src/`, `infra/`) | Clean history, conventional commits |
| 2 | README with setup | `README.md` | Fresh clone → running in ≤ 10 min using documented steps |
| 3 | OpenAPI schema | `openapi/openapi.yaml` | Lint passes; matches implementation |
| 4 | Architecture doc (2–4 pages) | `docs/architecture.md` | Contains all 9 architecture tasks below |
| 5 | Tests and CI pipeline | `tests/`, `.github/workflows/` | Green pipeline with gates |
| 6 | Observability setup | `infra/observability/` | Dashboards, alerts and trace flow demonstrable |
| 7 | Security checklist and threat model | `docs/security/` | STRIDE model, OWASP mapping, checklist with evidence |
| 8 | 5-minute demo video | link in README | Script in `docs/demo-script.md` |

### 9.1 Architecture Doc Must Contain
1. High-level architecture and data flow
2. Booking flow sequence diagram (Mermaid)
3. ER diagram (Mermaid)
4. API schema overview
5. Retry and backoff strategies
6. Data partitioning
7. Caching and concurrency handling
8. Transaction management and sagas
9. Backup and DR strategy

Plus: capacity estimates, trade-offs/alternatives considered, and a "what I'd do next" section.

### 9.2 Additional Docs
`docs/adr/*.md` (decisions), `docs/runbooks/*.md` (incident, failover, restore), `docs/security/threat-model.md` (STRIDE, attack surface, data classification), `docs/security/checklist.md`, `docs/perf/report.md`.

---

## 10. Success Criteria

### 10.1 Release Gates (all must pass; any failure = not done)
- [ ] All **P0** functional requirements implemented and covered by tests.
- [ ] Idempotency verified on every required endpoint (replay, mismatch, concurrent in-flight tests).
- [ ] Double-booking test: 1,000 concurrent attempts → exactly 1 success.
- [ ] MFA enforced for privileged roles; RBAC and ownership tests pass (including negative tests).
- [ ] No hard-coded secrets; secret scan clean; dependency/container scan has no Critical/High unresolved.
- [ ] PHI fields encrypted at rest; key rotation demonstrated by test.
- [ ] Audit log append-only (tamper attempt test) and chain verification passes.
- [ ] k6 results show p95 < 200 ms reads and < 500 ms writes at target load.
- [ ] CI pipeline green: lint, typecheck, unit, integration, coverage gate, scans, image build, OpenAPI validation.
- [ ] `docker compose up` brings up API, worker, Postgres, Redis, and observability stack; `README` steps verified from a clean clone.
- [ ] Documentation deliverables complete and consistent with the code.

### 10.2 Rubric Mapping (target score)

| Area | Weight | Where we earn it |
|---|---|---|
| Architecture | 20 | architecture.md, ADRs, diagrams, saga, partitioning |
| Core Flows | 20 | Auth, availability, booking, consultation, Rx, search, audit, analytics |
| Code Quality | 15 | Modular DI, typed, linted, tested, small functions, clear errors |
| Security | 10 | MFA, RBAC, encryption, threat model, scans |
| Observability | 10 | Metrics, logs, traces, SLO dashboards and alerts |
| Scalability | 10 | Partitioning, caching, stateless API, async jobs, load tests |
| Infra/CI | 10 | Terraform, Docker, GitHub Actions with gates |
| Bonus (+10) | — | Sagas with reconciliation, hash-chained audit, key-rotation tooling, chaos/failover test, SLO burn-rate alerts, GraphQL read API, prescription PDF |

---

## 11. Open Questions (record the answer as an ADR when resolved)
1. Cloud target for Terraform: assume AWS unless told otherwise.
2. Is a single timezone (IST) enough for demo data, or must multi-timezone be shown?
3. Refund policy defaults (assumed: full refund ≥ 24 h before, 50% 2–24 h, none < 2 h).
4. Are consultation modes beyond video (audio/chat) required? (Assumed: model the field, implement video only.)

If no human answer is available, the agent proceeds with the stated assumption, logs it in `progress.txt` as a decision, and creates an ADR.
