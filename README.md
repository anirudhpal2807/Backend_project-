# Amrutam Telemedicine Platform — Enterprise Backend

> **Production-Grade Modular Monolith Backend for High-Throughput Telemedicine**  
> Architected for 100,000 daily consultations with **Zero Double-Booking Guarantee**, **AES-256-GCM Envelope Encryption** for PHI/PII, **Rotating JWT Tokens & TOTP MFA**, **Deterministic Booking Sagas**, and **Cryptographically Hash-Chained Audit Logs**.

[![Continuous Integration](https://github.com/amrutam/telemedicine-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/amrutam/telemedicine-backend/actions)
[![Docker Security Scan](https://github.com/amrutam/telemedicine-backend/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/amrutam/telemedicine-backend/actions)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1.0-brightgreen.svg)](openapi/openapi.yaml)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-5.3%20Strict-blue.svg)](tsconfig.json)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

---

## 1. System Highlights & Architectural Guarantees

| Guarantee | Architectural Mechanism | Verification Test |
|---|---|---|
| **Zero Double-Booking** | Database `tstzrange` GiST exclusion constraints + partial unique index on active slot consultations + `SELECT FOR UPDATE` row locks | `tests/integration/concurrency-booking.spec.ts` (100 concurrent requests $\to$ 1 success, 99 clean 409 conflicts) |
| **Mutation Idempotency** | `@Idempotent()` interceptor with Redis/PostgreSQL fingerprinting, replay detection, and RFC 7807 problem details | `tests/unit/idempotency.spec.ts` |
| **PHI / PII Data Security** | Field-level AES-256-GCM envelope encryption with per-record DEKs and AWS KMS KEK rotation (`key_version`) | `tests/unit/crypto.spec.ts`, `tests/unit/security-hardening.spec.ts` |
| **Audit Ledger Integrity** | SHA-256 HMAC cryptographic hash chaining linking each event to `prev_hash` + PostgreSQL trigger prohibiting UPDATE/DELETE | `tests/unit/audit.spec.ts`, `tests/unit/audit-coverage.spec.ts` |
| **High Performance** | Fastify HTTP runtime + single-flight stampede protection + Redis cache-aside (P95 Read: **68ms**, P95 Write: **235ms**) | `docs/perf/report.md`, `docs/perf/load-test.js` |
| **High Availability** | 99.95% SLO ($\approx 21.6$ min/mo allowed downtime) with Google SRE multi-window multi-burn-rate Prometheus alert rules | `docs/slo.md`, `infra/observability/alert_rules.yml` |

---

## 2. Technology Stack

- **Runtime & Language**: Node.js 20 LTS, TypeScript 5.3 (`strict: true`, zero `any`)
- **Web Framework**: NestJS 10 on Fastify 4 (Low latency, high RPS)
- **Primary Database**: PostgreSQL 16 Multi-AZ (Kysely typed query builder, node-pg-migrate)
- **Distributed Cache & Queues**: Redis 7 Cluster (ioredis, BullMQ)
- **Authentication**: Argon2id hashing, rotating refresh tokens with token family reuse revocation, TOTP MFA
- **Observability**: Prometheus metrics (`/api/v1/metrics`), Grafana dashboard as code, OpenTelemetry W3C `traceparent` propagation, Pino structured JSON logging with recursive PHI redaction
- **Infrastructure as Code**: Terraform AWS modules (VPC, RDS, ElastiCache, ECS Fargate, KMS)
- **Specification**: OpenAPI 3.1 (`openapi/openapi.yaml`) with Spectral linting

---

## 3. Quick Start (Local Docker Compose)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose v2+
- [Node.js](https://nodejs.org/) v20+ & npm v10+

### Step 1: Clone & Configure Environment
```bash
git clone https://github.com/amrutam/telemedicine-backend.git
cd telemedicine-backend
cp .env.example .env
npm ci
```

### Step 2: One-Command Stack Startup
```bash
docker compose up -d
```
*This launches:*
- PostgreSQL 16 on `localhost:5432`
- Redis 7 on `localhost:6379`
- API Service on `http://localhost:3000`
- BullMQ Worker Service (outbox dispatch & slot reaper)

### Step 3: Run Database Migrations & Seeds
```bash
npm run migrate:up
npm run seed
```

### Step 4: Access Endpoints
- **API Base URL**: [http://localhost:3000/api/v1](http://localhost:3000/api/v1)
- **Swagger Documentation**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **Prometheus Metrics**: [http://localhost:3000/api/v1/metrics](http://localhost:3000/api/v1/metrics)
- **Health Probes**: [http://localhost:3000/api/v1/health/ready](http://localhost:3000/api/v1/health/ready)

---

## 4. Demo Accounts & Test Credentials

The database seed (`npm run seed`) pre-populates verified actors:

| Role | Email | Password | MFA Status | Purpose |
|---|---|---|---|---|
| **ADMIN** | `admin@amrutam.global` | `AdminPassword123!` | Enrolled | Doctor verification & platform governance |
| **DOCTOR** | `dr.ayurveda@amrutam.global` | `DoctorPassword123!` | Enrolled | Slot materialization & prescription issuance |
| **PATIENT** | `patient@amrutam.global` | `PatientPassword123!` | Disabled | Booking search, holds, & payment flows |
| **AUDITOR** | `auditor@amrutam.global` | `AuditorPassword123!` | Enrolled | Audit chain verification & GDPR exports |

*For a complete walkthrough using curl commands, see [docs/demo-script.md](docs/demo-script.md).*

---

## 5. Environment Configuration Reference

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | Number | `3000` | HTTP port for Fastify server |
| `API_PREFIX` | String | `api/v1` | Global API prefix path |
| `DB_HOST` | String | `localhost` | PostgreSQL host |
| `DB_PORT` | Number | `5432` | PostgreSQL port |
| `DB_NAME` | String | `amrutam_telemed` | Database name |
| `DB_USER` | String | `postgres` | Database user |
| `DB_PASSWORD` | String | `postgrespassword` | Database password |
| `DB_POOL_MIN` | Number | `2` | Minimum connection pool size |
| `DB_POOL_MAX` | Number | `20` | Maximum connection pool size |
| `REDIS_HOST` | String | `localhost` | Redis cluster host |
| `REDIS_PORT` | Number | `6379` | Redis port |
| `JWT_SECRET` | String | (32+ chars) | HMAC secret for short-lived access tokens (15m) |
| `REFRESH_TOKEN_SECRET`| String | (32+ chars) | Secret for rotating refresh tokens (7d) |
| `MASTER_ENCRYPTION_KEY`| Hex (64) | (32 bytes) | KEK for AES-256-GCM envelope encryption |
| `ENCRYPTION_KEY_VERSION`| String | `v1` | Active master key version identifier |
| `PAYMENT_WEBHOOK_SECRET`| String | (16+ chars) | HMAC signature secret for Stripe webhooks |

---

## 6. Testing & Quality Verification

```bash
# Run unit & integration test suites (123 tests across 25 suites)
npm test

# Run code coverage report with enforced thresholds (≥ 80%)
npm run test:cov

# Run code quality, format & TypeScript strict typechecking
npm run format
npm run lint
npm run typecheck

# Export & lint OpenAPI 3.1 specification
npm run export:openapi

# Production bundle compilation
npm run build
```

---

## 7. Performance Benchmarks

Detailed performance testing executed via k6 ([docs/perf/load-test.js](docs/perf/load-test.js)):

| Workload Profile | Throughput Target | Achieved Throughput | Target SLO Latency | Measured P95 Latency | Operational Headroom |
|---|---|---|---|---|---|
| **Doctor Search / Slots (Read)** | 500 RPS | **500 RPS** | $< 200\text{ ms}$ | **68 ms** | **66% Headroom** |
| **Booking Saga / Outbox (Write)**| 150 TPS | **150 TPS** | $< 500\text{ ms}$ | **235 ms** | **53% Headroom** |
| **Double-Booking Contention** | 100 simultaneous users | 100 racers | Exactly 1 booking | **100% Zero Double-Booking** | **Pass (1 Success, 99 409s)** |

*Complete performance analysis, bottleneck investigations, and database query explain plans are documented in [docs/perf/report.md](docs/perf/report.md).*

---

## 8. Documentation Index

- **System Architecture**: [docs/architecture.md](docs/architecture.md)
- **Interactive Demo Walkthrough**: [docs/demo-script.md](docs/demo-script.md)
- **Service Level Objectives & Burn-Rate Policy**: [docs/slo.md](docs/slo.md)
- **Zero-Downtime Migration Guide**: [docs/database/zero-downtime-migrations.md](docs/database/zero-downtime-migrations.md)
- **STRIDE Threat Model**: [docs/security/threat-model.md](docs/security/threat-model.md)
- **OWASP ASVS 4.0 Security Checklist**: [docs/security/checklist.md](docs/security/checklist.md)
- **Database Least-Privilege Architecture**: [docs/security/db-least-privilege.md](docs/security/db-least-privilege.md)
- **Disaster Recovery & PITR Runbook**: [docs/dr.md](docs/dr.md)
- **Operational Runbooks**:
  - [Queue Backlog & DLQ Triage](docs/runbooks/queue-dlq-backlog.md)
  - [Stuck Saga Recovery](docs/runbooks/stuck-sagas.md)
  - [Database Failover & Saturation](docs/runbooks/db-failover.md)
  - [Key Compromise & Emergency Rotation](docs/runbooks/key-rotation-compromise.md)
  - [Elevated Error Rate Incident Response](docs/runbooks/elevated-error-rate.md)
