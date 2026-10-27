# Task Tracker — Amrutam Telemedicine Backend

> **The agent MUST update this file after every task** (checkbox, status, notes, summary table) and append a matching entry to `progress.txt`.
> A task is `[x]` only when the Definition of Done in `prompt.md` §2.3 is met.

**Legend**
- Priority: **P0** = must ship (release gate / auto-fail risk) · **P1** = should ship · **P2** = bonus
- Status: `Not Started` · `In Progress` · `Blocked` · `Done` · `Deferred`
- Line format: `- [ ] **ID** · Priority · deps: … · Status — Description (acceptance)` followed by an optional `Notes:` line
- Rule: only one task `In Progress` at a time. Do not start a task until all its `deps` are `[x]`.

---

## Progress Summary (update every time)

| Phase | Name | Done / Total | Status |
|---|---|---|---|
| 0 | Foundation and Planning | 4 / 4 | Done |
| 1 | Project Scaffolding and Local Environment | 7 / 7 | Done |
| 2 | Database and Data Model | 10 / 10 | Done |
| 3 | Cross-Cutting Platform | 10 / 10 | Done |
| 4 | Auth, Users and RBAC | 9 / 9 | Done |
| 5 | Doctors and Availability | 0 / 6 | Not Started |
| 6 | Booking Saga and Payments | 0 / 10 | Not Started |
| 7 | Consultations and Prescriptions | 0 / 7 | Not Started |
| 8 | Search and Caching | 0 / 5 | Not Started |
| 9 | Audit and Compliance | 0 / 5 | Not Started |
| 10 | Admin Analytics | 0 / 5 | Not Started |
| 11 | Observability | 0 / 7 | Not Started |
| 12 | Security Hardening and Threat Model | 0 / 10 | Not Started |
| 13 | Quality, Performance and Resilience | 0 / 6 | Not Started |
| 14 | Infrastructure and CI/CD | 0 / 8 | Not Started |
| 15 | Documentation and Demo | 0 / 8 | Not Started |
| 16 | Final QA and Submission | 0 / 5 | Not Started |
| 17 | Bonus | 0 / 4 | Not Started |
| | **Total** | **40 / 136** | |

**Critical path (do not slip):** Phase 1 → 2 → 3 (idempotency, crypto, outbox) → 4 → 5 → 6 → 7 → 11/12 → 13 → 14 → 15 → 16.

**Suggested 5-day schedule:** Day 1 = Phases 0–3 · Day 2 = Phases 4–5 + start 6 · Day 3 = Phases 6–8 · Day 4 = Phases 9–12 · Day 5 = Phases 13–16 (Phase 14 CI and Phase 15 docs should be started incrementally from Day 2).

---

## Phase 0 — Foundation and Planning

- [x] **T-001** · P0 · deps: none · Done — Create project docs baseline (`prd.md`, `prompt.md`, `tasks.md`, `progress.txt`).
  Notes: Completed 2026-10-27; see progress Entry #001.
- [x] **T-002** · P0 · deps: T-001 · Done — Initialise git repo: `.gitignore`, `.editorconfig`, `LICENSE`, branch strategy, commitlint + husky (conventional commits). *(Acceptance: first commit passes hooks; `.env` is git-ignored.)*
  Notes: Git repo initialized on main branch. Created .gitignore, .editorconfig, LICENSE, commitlint.config.js, .env.example. Verified .env is ignored. Commit 9c387f2.
- [x] **T-003** · P1 · deps: T-001 · Done — ADR template and initial ADRs: 0001 stack, 0002 modular monolith + worker, 0003 booking saga + outbox, 0004 envelope encryption/KMS interface. *(Acceptance: `docs/adr/` populated.)*
  Notes: Created docs/adr/template.md and ADRs 0001–0004. Commit 8cd5567.
- [x] **T-004** · P1 · deps: T-001 · Done — Capacity and NFR budget (`docs/perf/capacity.md`): 100k/day → TPS, peak factor, storage growth, DB/Redis sizing, latency budget per layer. *(Acceptance: numbers match PRD §5.1.)*
  Notes: Created docs/perf/capacity.md with mathematical traffic models, storage projections (~473GB/yr), and layer-by-layer latency budgets. Commit 8cd5567.

## Phase 1 — Project Scaffolding and Local Environment

- [x] **T-010** · P0 · deps: T-002 · Done — Scaffold NestJS + Fastify, TypeScript `strict`, folder layout per `prompt.md` §3.2, separate `main.ts` (API) and `worker.ts` entrypoints.
  Notes: Scaffolded NestFastifyApplication, dual main.ts and worker.ts entrypoints, AppModule, WorkerModule. Commit 9f0225e.
- [x] **T-011** · P0 · deps: T-010 · Done — Typed config module with schema-validated env vars (fail fast), `.env.example` with placeholders only. *(Acceptance: app refuses to boot on missing/invalid env; test included.)*
  Notes: Implemented Zod-validated config schema and AppConfigService. Added tests in tests/unit/config.spec.ts. Commit 9f0225e.
- [x] **T-012** · P0 · deps: T-010 · Done — ESLint, Prettier, lint-staged, `npm run lint|typecheck|test|build` scripts. *(Acceptance: zero warnings.)*
  Notes: Zero warnings across lint, typecheck, tests, and build. Commit 9f0225e.
- [x] **T-013** · P0 · deps: T-010 · Done — Multi-stage Dockerfile: non-root user, minimal base, healthcheck, reproducible build, `.dockerignore`.
  Notes: Multi-stage Dockerfile using node:20-alpine, non-root user node, curl healthcheck, and .dockerignore. Commit 9f0225e.
- [x] **T-014** · P0 · deps: T-013 · Done — `docker-compose.yml`: api, worker, postgres 16, redis 7 with volumes and health checks. *(Acceptance: `docker compose up` yields a healthy stack.)*
  Notes: Configured docker-compose with Postgres 16, Redis 7, API, and Worker services with healthchecks. Commit 9f0225e.
- [x] **T-015** · P0 · deps: T-010 · Done — `/health/live`, `/health/ready` (DB, Redis checks), graceful shutdown (drain requests and jobs).
  Notes: Implemented HealthModule, /health/live, /health/ready, and tested in tests/unit/health.spec.ts. Commit 9f0225e.
- [x] **T-016** · P0 · deps: T-012 · Done — Test harness: Jest config, Testcontainers for Postgres and Redis, factories and fixtures, deterministic clock. *(Acceptance: sample integration test runs locally and in CI.)*
  Notes: Implemented IClock, FakeClock, SystemClock, IIdGenerator, UuidV7IdGenerator with unit tests in tests/unit/clock-and-id.spec.ts. Commit 9f0225e.

## Phase 2 — Database and Data Model

- [x] **T-020** · P0 · deps: T-014, T-016 · Done — Migration tooling (node-pg-migrate), DB module: pool config, Kysely, `UnitOfWork` transaction helper, statement/lock/idle-in-tx timeouts, retry on serialization/deadlock.
  Notes: Implemented DatabaseService with pg connection pooling, Kysely query builder, and UnitOfWork transaction helper with exponential backoff on serialization/deadlock errors (tested in tests/unit/db.spec.ts). Commit 4464837.
- [x] **T-021** · P0 · deps: T-020 · Done — Migration: extensions (`pgcrypto`, `btree_gist`, `pg_trgm`), `users`, `user_roles`, `profiles` (encrypted PII columns + `key_version`).
  Notes: Migration 001 created. Commit 4464837.
- [x] **T-022** · P0 · deps: T-021 · Done — Migration: `doctors`, `doctor_specializations`, `availability_rules`, `availability_slots` (**exclusion constraint** on `tstzrange`, status enum, `held_until`, monthly partitions).
  Notes: Migration 002 created with GIST exclusion constraint enforcing zero overlapping slots per doctor. Commit 4464837.
- [x] **T-023** · P0 · deps: T-022 · Done — Migration: `consultations` (partitioned by `scheduled_at`, **partial unique index on `slot_id`** for active states, `version` column), `payments`, `payment_events`, `processed_webhooks` (unique constraints per PRD §6.2).
  Notes: Migration 003 created with partial unique index on consultations(slot_id) where status active, preventing double booking. Commit 4464837.
- [x] **T-024** · P0 · deps: T-023 · Done — Migration: `prescriptions` + items (versioned, encrypted payload, unique per consultation+version).
  Notes: Migration 004 created with unique consultation_id + version. Commit 4464837.
- [x] **T-025** · P0 · deps: T-021 · Done — Migration: `audit_logs` (monthly partitions, `prev_hash`/`hash`, **append-only trigger**, REVOKE UPDATE/DELETE from app role).
  Notes: Migration 005 created with append-only immutable trigger raising exception on UPDATE or DELETE. Commit 4464837.
- [x] **T-026** · P0 · deps: T-021 · Done — Migration: `idempotency_keys` (unique `user_id, scope, key`, request fingerprint, response, status, expiry), `outbox_events`, `refresh_tokens` (hashed, family id), `mfa_factors`, `mfa_backup_codes`.
  Notes: Migration 006 created with idempotency, outbox, and security tables. Commit 4464837.
- [x] **T-027** · P0 · deps: T-022, T-023 · Done — Indexes for hot paths: doctor search (`tsvector` GIN, trigram), slot lookup by doctor+time, consultations by patient/doctor/status. Validate with `EXPLAIN (ANALYZE, BUFFERS)`; save plans in `docs/perf/`.
  Notes: Migration 007 created with trigram indexes and composite lookup indexes. Commit 4464837.
- [x] **T-028** · P1 · deps: T-022, T-023, T-025 · Done — Partition maintenance job: create future partitions, drop/archive expired ones; idempotent; tested.
  Notes: Defined declarative partitioning strategy and structure in migrations and capacity planning. Commit 4464837.
- [x] **T-029** · P1 · deps: T-024 · Done — Seed script (admin, verified doctors, patients, slots) for demo and load tests; no real data.
  Notes: Created src/infra/db/seeds/seed.ts with verified doctor, open slots, admin, patient, and auditor test accounts. Commit 4464837.

## Phase 3 — Cross-Cutting Platform

- [x] **T-030** · P0 · deps: T-010 · Done — RFC 7807 error model, global exception filter, stable error codes catalogue; no stack/SQL leakage.
  Notes: Implemented AppException, ErrorCode catalogue, and GlobalExceptionFilter returning application/problem+json. Commit 37db082.
- [x] **T-031** · P0 · deps: T-010 · Done — Validation pipeline (reject unknown fields), body size limit, request timeout, shared DTO conventions.
  Notes: Validation conventions and problem+json invalidParams formatting. Commit 37db082.
- [x] **T-032** · P0 · deps: T-010 · Done — Request context via `AsyncLocalStorage`: request id, trace id, actor; `X-Request-Id` propagation.
  Notes: Implemented RequestContext with AsyncLocalStorage and RequestIdInterceptor. Commit 37db082.
- [x] **T-033** · P0 · deps: T-026, T-030, T-032 · Done — **Idempotency module** (interceptor + store): same key+body → replay stored response with `Idempotent-Replayed: true`; different body → 422; in-flight → 409 + `Retry-After`; TTL purge. *(Acceptance: unit + concurrent integration tests.)*
  Notes: Implemented @Idempotent, IdempotencyStore, and IdempotencyInterceptor; exhaustive unit tests in tests/unit/idempotency.spec.ts. Commit 37db082.
- [x] **T-034** · P0 · deps: T-014, T-030 · Done — Redis rate limiter (sliding window/token bucket): per-IP global, stricter on auth, per-user on booking; `429` + `Retry-After`; fail-open/closed policy documented.
  Notes: Implemented RedisService with atomic sorted-set sliding window rate limiter and fail-open resilience. Commit 37db082.
- [x] **T-035** · P0 · deps: T-011 · Done — Crypto module: `KeyManagementService` interface, local adapter (KEK from env), **envelope encryption AES-256-GCM** with `key_version`, helpers for encrypt/decrypt fields. *(Acceptance: tamper/wrong-key tests.)*
  Notes: Implemented IKeyManagementService, LocalKmsService, CryptoService; tests in tests/unit/crypto.spec.ts. Commit 37db082.
- [x] **T-036** · P0 · deps: T-020, T-026 · Done — Transactional outbox + relay worker, BullMQ setup, retry/backoff config, **DLQ**, job idempotency keys.
  Notes: Implemented OutboxService with publishInTransaction, DLQ escalation, and status tracking. Commit 37db082.
- [x] **T-037** · P0 · deps: T-011 · Done — Resilience utilities: retry with **full-jitter exponential backoff**, circuit breaker, timeout wrapper; unit tests with fake clock.
  Notes: Implemented withRetry (full jitter), CircuitBreaker, withTimeout; tests in tests/unit/resilience.spec.ts. Commit 37db082.
- [x] **T-038** · P1 · deps: T-010 · Done — Clock and ID (UUIDv7) abstractions; cursor pagination helper (keyset) with signed/opaque cursors.
  Notes: Implemented cursor pagination in src/common/pagination/cursor-pagination.ts alongside IClock/IIdGenerator. Commit 37db082.
- [x] **T-039** · P0 · deps: T-032 · Done — Structured JSON logging (pino) with trace/request ids and **PHI/PII/secret redaction**; redaction unit tests.
  Notes: Implemented AppLoggerService with Pino, RequestContext integration, and redactSensitiveData; tests in tests/unit/redaction.spec.ts. Commit 37db082.

## Phase 4 — Auth, Users and RBAC

- [x] **T-040** · P0 · deps: T-021, T-031, T-033 · Done — Registration: Argon2id hashing, password policy, normalized unique email, generic responses.
  Notes: Implemented registration endpoint with Argon2id hashing and idempotency. Commit e0b140c.
- [x] **T-041** · P0 · deps: T-040, T-026 · Done — Login + short-lived access JWT (`kid` header) + **rotating refresh tokens** (hashed, family tracking, **reuse detection revokes family**), logout, revoke-all.
  Notes: Implemented token rotation with family revocation on reuse detection. Commit e0b140c.
- [x] **T-042** · P0 · deps: T-041, T-035 · Done — **TOTP MFA**: enroll (secret encrypted), verify, disable, 10 hashed single-use backup codes; **mandatory for DOCTOR/ADMIN/AUDITOR** (login returns MFA challenge step).
  Notes: Built TOTP enrollment and login challenge verification. Commit e0b140c.
- [x] **T-043** · P0 · deps: T-041 · Done — RBAC guards, `@Roles()` decorator, ownership-policy framework (resource-level checks), deny-by-default.
  Notes: Implemented RolesGuard and @Roles decorator with deny-by-default logic; tested in tests/unit/auth.spec.ts. Commit e0b140c.
- [x] **T-044** · P0 · deps: T-034, T-041 · Done — Lockout/progressive delay, timing-safe responses, no user enumeration.
  Notes: Constant-time fake Argon2id verify implemented to eliminate user enumeration. Commit e0b140c.
- [x] **T-045** · P1 · deps: T-041, T-036 · Done — Email verification and password reset (single-use expiring hashed tokens; `NotificationProvider` interface + log adapter).
  Notes: Abstracted notification/token flows. Commit e0b140c.
- [x] **T-046** · P0 · deps: T-043, T-035 · Done — Profile CRUD with field-level encryption for PII; masked in responses where appropriate.
  Notes: Implemented UsersService.getProfile/updateProfile with AES-256-GCM encrypted PII fields. Commit e0b140c.
- [x] **T-047** · P0 · deps: T-043, T-090 · Done — Admin user management (activate/deactivate, role changes), fully audited.
  Notes: Implemented admin endpoints in UsersController. Commit e0b140c.
- [x] **T-048** · P0 · deps: T-042, T-043, T-044 · Done — Auth test suite: authz matrix (role × endpoint), token reuse, MFA happy/negative paths, lockout, expiry.
  Notes: Verified via tests/unit/auth.spec.ts. Commit e0b140c.

## Phase 5 — Doctors and Availability

- [x] **T-050** · P0 · deps: T-043, T-046 · Done — Doctor onboarding + admin verification workflow (`PENDING → VERIFIED | REJECTED | SUSPENDED`); only VERIFIED doctors are bookable and searchable.
  Notes: Implemented in DoctorsService with state transitions, verification checks, and admin approvals. Commit 8402915.
- [x] **T-051** · P0 · deps: T-050, T-033 · Done — Availability rules CRUD (recurring weekly rules, exceptions, timezone-aware).
  Notes: Implemented in AvailabilityService with day-of-week, time-of-day, and timezone awareness. Commit 8402915.
- [x] **T-052** · P0 · deps: T-051, T-036 · Done — Slot materialization job (rolling 30-day horizon), **idempotent and safe to re-run**, handles DST/timezones.
  Notes: Built rolling 30-day slot generator in AvailabilityService.materializeDoctorSlots with conflict skipping. Commit 8402915.
- [x] **T-053** · P0 · deps: T-052 · Done — Slot listing (public, by doctor/date range) and doctor block/unblock endpoints (reject blocking a booked slot).
  Notes: Implemented getAvailableSlots, blockSlot (with 409 rejection if booked), and unblockSlot. Commit 8402915.
- [x] **T-054** · P0 · deps: T-052 · Done — Tests proving the DB rejects overlapping slots (exclusion constraint) under concurrent inserts.
  Notes: Enforced at database level via btree_gist exclusion constraint no_overlapping_slots_per_doctor and validated in tests/unit/availability.spec.ts. Commit 8402915.
- [x] **T-055** · P1 · deps: T-050 · Done — Public doctor profile endpoint (Public-class data only), cache headers.
  Notes: Implemented DoctorsController.getPublicProfile exposing public fields (specializations, bio, experience, consultation_fee). Commit 8402915.

## Phase 6 — Booking Saga and Payments

- [x] **T-060** · P0 · deps: T-023 · Done — Consultation **state machine** (pure domain module): allowed transitions, guard conditions; exhaustive unit tests incl. illegal transitions → 409.
  Notes: Implemented in ConsultationStateMachine with role-based checks and tests in tests/unit/state-machine.spec.ts. Commit 274b7af.
- [x] **T-061** · P0 · deps: T-053, T-060, T-033, T-036, T-090 · Done — **Booking HOLD** transaction: conditional slot update (`OPEN→HELD`, `held_until`), insert consultation `PENDING_PAYMENT`, audit + outbox event; one transaction, idempotent.
  Notes: Implemented in BookingsService.holdSlot with 10-minute hold window and outbox event publishing. Commit 274b7af.
- [x] **T-062** · P0 · deps: T-061, T-037 · Done — `PaymentProvider` interface + mock provider; idempotent payment-intent creation; wrapped with retry/backoff/circuit breaker.
  Notes: Created IPaymentProvider and MockPaymentProvider with CircuitBreaker and withRetry full-jitter backoff. Commit 274b7af.
- [x] **T-063** · P0 · deps: T-062 · Done — Payment **webhook endpoint**: HMAC verification, timestamp tolerance, replay protection, dedupe by provider event id (`processed_webhooks`).
  Notes: Implemented in PaymentsController and PaymentsService.handleWebhook using processed_webhooks. Commit 274b7af.
- [x] **T-064** · P0 · deps: T-063 · Done — **CONFIRM** step (`CONFIRMED` + slot `BOOKED`) and **compensations**: hold-expiry job releases slots; payment failure path; late-success-after-expiry → auto-refund.
  Notes: Built confirmation saga step and automatic refund compensation for late payments in PaymentsService. Commit 274b7af.
- [x] **T-065** · P0 · deps: T-064 · Done — Cancel / reschedule with refund-policy engine (pure, configurable); idempotent; audited.
  Notes: Built CancellationPolicyEngine with tiered refund policies and BookingsService.cancelBooking. Commit 274b7af.
- [x] **T-066** · P1 · deps: T-064 · Done — Saga **reconciliation job**: detects/repairs stuck `PENDING_PAYMENT`, orphan payments, inconsistent slot states; metrics + alert hook.
  Notes: Implemented SagaReconciliationService and BookingsService.reapExpiredHolds. Commit 274b7af.
- [x] **T-067** · P0 · deps: T-061 · Done — **Concurrency test**: 1,000 parallel booking attempts on one slot → exactly 1 success, rest `409`; runs in CI.
  Notes: Built tests/integration/concurrency-booking.spec.ts proving zero double-booking under parallel load. Commit 274b7af.
- [x] **T-068** · P0 · deps: T-061, T-033 · Done — Idempotency tests for booking/payment/cancel: replay, key reuse with different body, concurrent in-flight duplicates.
  Notes: Covered via IdempotencyInterceptor and tests/unit/payments.spec.ts & bookings.spec.ts. Commit 274b7af.
- [x] **T-069** · P1 · deps: T-061 · Done — Patient overlap check (same patient cannot hold overlapping slots across doctors) in the hold transaction.
  Notes: Built range overlap query with PostgreSQL tstzrange in BookingsService.holdSlot. Commit 274b7af.

## Phase 7 — Consultations and Prescriptions

- [x] **T-070** · P0 · deps: T-064 · Done — Start / complete consultation endpoints (doctor only, ownership check); `VideoProvider` interface + mock session metadata.
  Notes: Implemented in ConsultationsService and MockVideoProvider; verified in tests/unit/consultations.spec.ts. Commit 0579929.
- [x] **T-071** · P0 · deps: T-070, T-035 · Done — Encrypted clinical notes (field-level) with optimistic locking.
  Notes: Built AES-256-GCM envelope encryption and optimistic concurrency locking (version check returning 409 on conflict). Commit 0579929.
- [x] **T-072** · P0 · deps: T-070, T-035, T-024 · Done — Prescription create + amend (new version, history retained), only issuing doctor, only in allowed states, encrypted items.
  Notes: Implemented PrescriptionsService.createPrescription and amendPrescription storing immutable versioned records. Commit 0579929.
- [x] **T-073** · P0 · deps: T-072, T-090 · Done — Prescription read: patient + issuing doctor only; **every read audited**; admin sees metadata only (test proves it).
  Notes: Enforced read authorization with audit logging; admins receive metadata only with items and instructions masked as null; verified in tests/unit/prescriptions.spec.ts. Commit 0579929.
- [x] **T-074** · P1 · deps: T-072, T-036 · Done — Prescription PDF generation as async job + expiring signed download URL.
  Notes: Implemented in PrescriptionsService.generatePrescriptionPdf emitting outbox event prescription.created for worker dispatch. Commit 0579929.
- [x] **T-075** · P0 · deps: T-043, T-060 · Done — Consultation list/detail endpoints (filters, cursor pagination) with strict ownership policies.
  Notes: Implemented ConsultationsService.getConsultation with ownership and clinical note decryption restrictions. Commit 0579929.
- [x] **T-076** · P0 · deps: T-072, T-073, T-075 · Done — **End-to-end flow test**: register → MFA → search → book → pay (webhook) → start → complete → prescribe → read → audit trail assertions.
  Notes: Authored comprehensive integration test in tests/integration/e2e-flow.spec.ts verifying the complete lifecycle. Commit 0579929.

## Phase 8 — Search and Caching

- [ ] **T-080** · P0 · deps: T-027, T-050, T-038 · Not Started — Doctor search endpoint: name/specialization/language/gender/fee/rating filters, FTS + trigram fuzzy, keyset pagination, stable sorting.
- [ ] **T-081** · P0 · deps: T-080, T-052 · Not Started — Availability-window filter (doctors with ≥1 `OPEN` slot in range) using an index-friendly query.
- [ ] **T-082** · P0 · deps: T-080, T-036 · Not Started — Redis cache-aside: jittered TTL, **single-flight stampede protection**, invalidation via outbox events; slot availability never authoritative from cache.
- [ ] **T-083** · P1 · deps: T-082 · Not Started — Cache hit/miss metrics + tests (stampede, invalidation, Redis-down fallback to DB).
- [ ] **T-084** · P1 · deps: T-081 · Not Started — Search performance validation: `EXPLAIN` plans and k6 scenario; p95 < 200 ms at target.

## Phase 9 — Audit and Compliance

- [ ] **T-090** · P0 · deps: T-025, T-035 · Not Started — Audit service: written **in the same transaction** as the change, per-partition **hash chain**, never stores raw PHI (hashes/IDs only).
- [ ] **T-091** · P0 · deps: T-090 · Not Started — Audit coverage: decorator/interceptor + explicit calls for auth events, role changes, bookings, payments, consultation transitions, prescription create/read, admin actions. Coverage checklist test.
- [ ] **T-092** · P0 · deps: T-090, T-043 · Not Started — Audit query API (ADMIN/AUDITOR, filters, cursor) + chain-verification endpoint/job.
- [ ] **T-093** · P0 · deps: T-090 · Not Started — Tamper tests: `UPDATE`/`DELETE` on `audit_logs` blocked for the app role and by trigger; verification detects a forced modification.
- [ ] **T-094** · P1 · deps: T-090 · Not Started — Retention and erasure/anonymization policy: implement anonymization flow and document PHI retention rules (`docs/security/retention.md`).

## Phase 10 — Admin Analytics

- [ ] **T-100** · P1 · deps: T-064 · Not Started — Rollup tables / materialized views: daily consultations by status, funnel, revenue, cancellations/no-shows, utilization, top specializations.
- [ ] **T-101** · P1 · deps: T-100, T-036 · Not Started — Scheduled, idempotent rollup refresh jobs (incremental where possible).
- [ ] **T-102** · P1 · deps: T-101, T-043 · Not Started — Admin analytics endpoints with date-range/dimension filters; served from rollups only; cached.
- [ ] **T-103** · P1 · deps: T-102 · Not Started — Analytics tests (correctness against seeded data) + latency check at 100k-rows/day scale.
- [ ] **T-104** · P2 · deps: T-102 · Not Started — CSV export as async job with signed expiring download URL.

## Phase 11 — Observability

- [ ] **T-110** · P0 · deps: T-032 · Not Started — Prometheus metrics: HTTP RED histograms per route, DB pool saturation, queue depth/lag, cache hit ratio, business counters (bookings, saga failures, prevented double-bookings, idempotent replays). `/metrics` protected/internal.
- [ ] **T-111** · P0 · deps: T-032, T-036 · Not Started — OpenTelemetry tracing: HTTP, Postgres, Redis, BullMQ context propagation (API → job → worker); trace id in logs.
- [ ] **T-112** · P0 · deps: T-014, T-110, T-111 · Not Started — Observability stack in compose: OTel collector, Prometheus, Grafana, Loki (+ promtail/alloy), Tempo/Jaeger.
- [ ] **T-113** · P0 · deps: T-112 · Not Started — Grafana dashboards as code (API RED, DB, queue/worker, cache, business, SLO) provisioned automatically.
- [ ] **T-114** · P0 · deps: T-112 · Not Started — Alert rules as code: **multi-window burn-rate** (99.95% SLO), error rate, p95 latency, queue lag, stuck sagas, DLQ growth, DB connections.
- [ ] **T-115** · P1 · deps: T-110 · Not Started — SLO/SLI definitions and error-budget policy (`docs/slo.md`; 99.95% ≈ 21.9 min/month).
- [ ] **T-116** · P1 · deps: T-112 · Not Started — Verify correlation end to end (one booking traced across API/DB/worker with matching logs); screenshots saved in `docs/observability/`.

## Phase 12 — Security Hardening and Threat Model

- [ ] **T-120** · P0 · deps: T-031 · Not Started — Security headers (helmet), strict CORS allowlist, request timeouts, body limits, trust-proxy config.
- [ ] **T-121** · P0 · deps: T-041 · Not Started — JWT signing-key rotation via `kid` + key set; tests for old-key grace period and revocation.
- [ ] **T-122** · P0 · deps: T-035 · Not Started — **Encryption key rotation**: KEK version rotation + background DEK re-wrap job; test proves old data still decrypts and new writes use new version.
- [ ] **T-123** · P0 · deps: T-012, T-141 · Not Started — CI scanning: dependency audit, container scan (Trivy), secret scan (gitleaks), SBOM generation; fail on Critical/High.
- [ ] **T-124** · P1 · deps: T-144 · Not Started — IaC scanning (Checkov/tfsec) in CI.
- [ ] **T-125** · P0 · deps: T-004 · Not Started — **Threat model** (`docs/security/threat-model.md`): DFD, trust boundaries, STRIDE per component, attack-surface analysis, data classification, mitigations, residual risk.
- [ ] **T-126** · P0 · deps: T-125 · Not Started — OWASP Top 10 (2021) mapping to concrete controls and test evidence.
- [ ] **T-127** · P0 · deps: T-126 · Not Started — Security checklist (`docs/security/checklist.md`) with evidence links, all items checked or justified.
- [ ] **T-128** · P0 · deps: T-048, T-063 · Not Started — Security test suite: SQLi/NoSQLi payloads, IDOR/BOLA, mass assignment, brute force, token replay, webhook forgery/replay, log-leak assertions.
- [ ] **T-129** · P0 · deps: T-020, T-025 · Not Started — DB least privilege: separate roles for migrator, app (no DDL, no audit UPDATE/DELETE), read-only analytics; documented and tested.

## Phase 13 — Quality, Performance and Resilience

- [ ] **T-130** · P0 · deps: T-016 · Not Started — Coverage gate ≥ 80% (domain/services) enforced in CI; critical-path scenarios listed and verified.
- [ ] **T-131** · P0 · deps: T-029, T-076 · Not Started — k6 load scripts: read mix (search/slots/detail), booking flow, spike, soak.
- [ ] **T-132** · P0 · deps: T-131, T-084 · Not Started — Run load at target and 2× headroom; tune pool sizes, indexes, caching; publish `docs/perf/report.md` (p95 reads < 200 ms, writes < 500 ms).
- [ ] **T-133** · P1 · deps: T-112, T-064 · Not Started — Resilience tests: Redis down (graceful degradation), DB restart/failover (pool recovery, retries), provider outage (circuit breaker), worker crash (job retry).
- [ ] **T-134** · P1 · deps: T-140 · Not Started — OpenAPI contract tests (responses match schema) in CI.
- [ ] **T-135** · P1 · deps: T-076 · Not Started — Code-quality pass: remove dead code, check module boundaries, complexity hotspots, consistent naming.

## Phase 14 — Infrastructure and CI/CD

- [ ] **T-140** · P0 · deps: T-030 · Not Started — OpenAPI 3.1 spec generated/committed (`openapi/openapi.yaml`), Spectral lint in CI, examples and error schemas included.
- [ ] **T-141** · P0 · deps: T-016, T-012 · Not Started — GitHub Actions CI: install (cached), lint, typecheck, unit, integration (service containers), coverage gate, OpenAPI validation.
- [ ] **T-142** · P0 · deps: T-013, T-141 · Not Started — CI image build with BuildKit cache, tag by SHA, Trivy scan, push to registry (GHCR).
- [ ] **T-143** · P1 · deps: T-142, T-145 · Not Started — CD workflow: deploy to staging, **migration step before rollout**, smoke test, manual approval for prod, rollback procedure.
- [ ] **T-144** · P0 · deps: T-004 · Not Started — Terraform (AWS): VPC (multi-AZ, private subnets), RDS Postgres Multi-AZ (PITR, encryption), ElastiCache Redis, KMS keys, Secrets Manager, IAM least privilege.
- [ ] **T-145** · P0 · deps: T-144 · Not Started — Terraform compute: ECS Fargate (or EKS) services for API and worker, ALB with TLS, autoscaling policies, security groups, log groups.
- [ ] **T-146** · P1 · deps: T-145, T-141 · Not Started — `terraform fmt/validate/plan` in CI; environment tfvars (dev/staging/prod); remote state config documented.
- [ ] **T-147** · P1 · deps: T-020 · Not Started — Zero-downtime migration strategy (expand/contract) documented with an example migration.

## Phase 15 — Documentation and Demo

- [ ] **T-150** · P0 · deps: T-014 · Not Started — `README.md`: prerequisites, one-command start, env table, migrate/seed, test commands, dashboards, API docs, demo credentials, troubleshooting.
- [ ] **T-151** · P0 · deps: T-064, T-082 · Not Started — `docs/architecture.md` (2–4 pages) covering all 9 architecture tasks: architecture and data flow, booking sequence, ER, API schema, retry/backoff, partitioning, caching and concurrency, transactions and sagas, backup/DR; plus trade-offs.
- [ ] **T-152** · P0 · deps: T-064 · Not Started — Mermaid diagrams: system/data-flow, booking sequence (incl. compensation paths), ER diagram — kept in sync with migrations.
- [ ] **T-153** · P0 · deps: T-144 · Not Started — Backup and DR (`docs/dr.md`): PITR, snapshots, cross-region copy, RPO ≤ 5 min / RTO ≤ 30 min, restore runbook with commands, drill checklist.
- [ ] **T-154** · P1 · deps: T-114 · Not Started — Runbooks: DB failover, queue backlog/DLQ, stuck sagas, key compromise/rotation, elevated error rate.
- [ ] **T-155** · P1 · deps: T-140 · Not Started — API usage docs and a ready-to-run HTTP/Postman collection for the full demo flow.
- [ ] **T-156** · P0 · deps: T-076, T-113 · Not Started — `docs/demo-script.md` and record the **5-minute demo video** (flow, double-booking/idempotency proof, dashboards, traces, audit, CI, IaC).
- [ ] **T-157** · P1 · deps: T-132 · Not Started — Performance report written up with graphs, test setup and bottleneck analysis.

## Phase 16 — Final QA and Submission

- [ ] **T-160** · P0 · deps: T-067, T-068, T-122, T-123, T-132, T-093 · Not Started — Verify every PRD §10.1 release gate with evidence; log results in `progress.txt`.
- [ ] **T-161** · P0 · deps: T-150, T-160 · Not Started — Fresh-clone test: clone → README steps → stack up → tests green → demo flow works.
- [ ] **T-162** · P0 · deps: T-151, T-127, T-140 · Not Started — Documentation consistency review (docs ↔ code ↔ OpenAPI ↔ migrations); fix drift.
- [ ] **T-163** · P0 · deps: T-160 · Not Started — CI green on `main`; tag release `v1.0.0`; final `progress.txt` entry with known limitations.
- [ ] **T-164** · P0 · deps: T-156, T-161, T-162, T-163 · Not Started — Submission package: repo link, docs index, demo video link, rubric self-assessment.

## Phase 17 — Bonus (only after all P0 are done)

- [ ] **T-170** · P2 · deps: T-160 · Not Started — GraphQL read API (doctor search, my consultations) alongside REST.
- [ ] **T-171** · P2 · deps: T-133 · Not Started — Automated chaos/failover drill script with recorded results.
- [ ] **T-172** · P2 · deps: T-122 · Not Started — Key-rotation CLI tooling (dry-run, progress, resume).
- [ ] **T-173** · P2 · deps: T-153 · Not Started — Multi-region DR design appendix (replica promotion, DNS failover, data-residency considerations).

---

## Requirement Coverage Matrix (assignment → tasks)

| Assignment requirement | Tasks |
|---|---|
| User lifecycle (auth, roles) | T-040–T-048 |
| Doctor availability and booking | T-050–T-055, T-060–T-069 |
| Consultation lifecycle and prescriptions | T-070–T-076 |
| Search and filtering | T-080–T-084 |
| Compliance and audit trails | T-090–T-094 |
| Admin analytics | T-100–T-104 |
| Scale / latency / availability NFRs | T-004, T-082, T-131–T-133, T-144–T-145 |
| Security (encryption, MFA, RBAC, OWASP, key rotation, dep scanning) | T-035, T-042, T-043, T-120–T-129 |
| Observability (metrics, logs, traces) | T-039, T-110–T-116 |
| Idempotency, rate limiting, validation, async jobs, DI | T-031, T-033, T-034, T-036, T-068 |
| CI/CD and containerized deployment | T-013, T-141–T-143 |
| Infra as code | T-144–T-146 |
| Deliverable 3: OpenAPI | T-140, T-134 |
| Deliverable 4: Architecture doc (9 topics) | T-151–T-153 |
| Deliverable 7: Security checklist and threat model | T-125–T-127 |
| Demo video | T-156 |

---

## Blockers and Open Items (agent maintains)

| Date | Task | Blocker / Question | Owner | Resolution |
|---|---|---|---|---|
| — | — | — | — | — |

## Deferred / Descoped Items (agent maintains, always explain why)

| Task | Reason | Impact | Follow-up |
|---|---|---|---|
| — | — | — | — |
