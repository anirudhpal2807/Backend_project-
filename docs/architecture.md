# Amrutam Telemedicine Platform — System Architecture & Engineering Blueprint

---

## 1. System Overview & Component Architecture

The Amrutam Telemedicine Platform is structured as a **modular monolith** with decoupled runtime execution tiers:
1. **API Tier (`src/main.ts`)**: Fastify-backed NestJS HTTP engine serving REST APIs, RFC 7807 problem details, OpenAPI 3.1 documentation, and Prometheus metrics.
2. **Background Worker Tier (`src/worker.ts`)**: Dedicated BullMQ queue consumer processing transactional outbox events, slot hold expirations (10-minute hold reaper), saga reconciliation, and analytical rollups.
3. **Data & State Tier**:
   - **PostgreSQL 16 Multi-AZ**: Relational single source of truth utilizing monthly partition tables, `tstzrange` GiST exclusion constraints, and partial unique indexes.
   - **Redis 7 Cluster**: Distributed cache-aside layer with single-flight stampede suppression, sliding-window rate limiters, and BullMQ task queues.

```mermaid
flowchart TD
    subgraph Clients["Clients & Gateways"]
        Web[Web Browser / React]
        Mobile[Mobile App / Flutter]
        StripeWebhook[Stripe Webhooks]
    end

    subgraph Ingress["Ingress & Edge Security"]
        ALB["AWS Application Load Balancer (HTTPS / TLS 1.3)"]
        WAF["AWS WAF (Rate Limiting / Geo-Blocking / OWASP Rules)"]
    end

    subgraph Compute["ECS Fargate Multi-AZ Cluster"]
        subgraph APIService["API Service (Fastify / NestJS Monolith)"]
            AuthModule["Auth & RBAC (Argon2id / Rotating JWT / TOTP)"]
            DocModule["Doctors & Availability Engine"]
            BookingModule["Booking Saga Orchestrator"]
            ConsultModule["Consultations & Prescriptions (AES-256-GCM)"]
            AuditModule["Audit Hash-Chain Engine (SHA-256)"]
            AnalyticsModule["Analytics Rollup Aggregator"]
        end

        subgraph WorkerService["Worker Service (BullMQ Runner)"]
            OutboxRelay["Outbox Relay Worker"]
            SlotReaper["Slot Hold Expiration Reaper (10m)"]
            RollupWorker["Analytics Daily Rollup Worker"]
            DLQWorker["Dead Letter Queue (DLQ) Manager"]
        end
    end

    subgraph DataStorage["Persistence & Distributed State"]
        subgraph Postgres["PostgreSQL 16 Multi-AZ"]
            ActiveDB[("Primary Database (Read/Write)")]
            ReplicaDB[("Standby Replica (Automated Failover)")]
            Partitions[("Monthly Partitions: Consultations, Slots, Audit")]
        end

        subgraph Redis["Redis 7 Cluster"]
            RateLimitCache[("Sliding Window Rate Limiter")]
            SearchCache[("Doctor Search Cache-Aside")]
            BullQueues[("BullMQ Stream Queues")]
        end

        KMS[("AWS KMS CMKs: KEK & Storage Encryption")]
    end

    Web --> ALB
    Mobile --> ALB
    StripeWebhook --> ALB
    ALB --> APIService

    APIService --> RateLimitCache
    APIService --> SearchCache
    APIService --> ActiveDB
    APIService --> BullQueues
    APIService --> KMS

    WorkerService --> BullQueues
    WorkerService --> ActiveDB
    ActiveDB -. Synchronous Streaming .-> ReplicaDB
```

---

## 2. Concurrency Control & Zero Double-Booking Guarantee

Double-booking represents an auto-fail risk in telemedicine. The Amrutam platform guarantees **zero double-booking** through mathematical defense-in-depth across three architectural layers:

```mermaid
sequenceDiagram
    autonumber
    participant PatientA as Patient A (Client)
    participant PatientB as Patient B (Concurrent)
    participant API as Booking Service
    participant DB as PostgreSQL 16
    participant Redis as Redis Queue

    Note over PatientA,PatientB: Simultaneous booking attempt for Doctor X at Slot T0
    PatientA->>API: POST /bookings/hold (Slot ID, Idempotency-Key 1)
    PatientB->>API: POST /bookings/hold (Slot ID, Idempotency-Key 2)

    API->>DB: BEGIN TRANSACTION (ISOLATION LEVEL READ COMMITTED)
    Note over DB: Atomic Row Lock: SELECT * FROM availability_slots WHERE id = $1 FOR UPDATE
    DB-->>API: Patient A acquires row lock first

    API->>DB: UPDATE availability_slots SET status = 'HELD', held_until = NOW() + 10m WHERE id = $1 AND status = 'OPEN'
    DB-->>API: 1 Row Updated
    API->>DB: INSERT INTO consultations (id, slot_id, status = 'PENDING_PAYMENT')
    Note over DB: Checked against Partial Unique Index: idx_consultations_active_slot_unique
    DB-->>API: Consultation Record Inserted
    API->>DB: COMMIT TRANSACTION
    API-->>PatientA: 201 Created (Hold Token, Expires in 600s)

    Note over API,DB: Patient B's blocked transaction proceeds
    API->>DB: SELECT * FROM availability_slots WHERE id = $1 FOR UPDATE
    DB-->>API: Slot Status is now 'HELD' (status = 'OPEN' predicate fails)
    API->>DB: ROLLBACK TRANSACTION
    API-->>PatientB: 409 Conflict (ErrorCode: SLOT_ALREADY_BOOKED)
```

### Database Enforcement Mechanics:
1. **GiST Exclusion Constraint (`tstzrange`)**:
   ```sql
   ALTER TABLE availability_slots ADD CONSTRAINT no_overlapping_slots_per_doctor
   EXCLUDE USING gist (doctor_id WITH =, tstzrange(start_time, end_time) WITH &&);
   ```
   Prevents overlapping time slots for a single doctor even across concurrent slot generation tasks.
2. **Partial Unique Index on Active Consultations**:
   ```sql
   CREATE UNIQUE INDEX idx_consultations_active_slot_unique
   ON consultations (slot_id)
   WHERE status NOT IN ('CANCELLED', 'EXPIRED');
   ```
   Guarantees at the database B-Tree index level that two consultations can never reference the same physical slot unless previous bookings are cancelled or expired.
3. **Pessimistic Row-Level Locking**:
   All booking state mutations execute within `SELECT FOR UPDATE` blocks, serializing concurrent writes without race windows.

---

## 3. Booking Saga & State Machine Architecture

The consultation lifecycle is modeled as a formal deterministic finite-state automaton:

```mermaid
stateDiagram-v2
    [*] --> DRAFT: Patient initiates selection
    DRAFT --> PENDING_PAYMENT: Hold Slot (10 min TTL)
    PENDING_PAYMENT --> CONFIRMED: Payment Succeeded (Webhook)
    PENDING_PAYMENT --> EXPIRED: 10m TTL expires without payment
    PENDING_PAYMENT --> CANCELLED: Patient cancels hold

    CONFIRMED --> IN_PROGRESS: Consultation starts (Daily.co Room active)
    CONFIRMED --> CANCELLED: Patient/Doctor cancels (Refund evaluated)

    IN_PROGRESS --> COMPLETED: Doctor signs off & files notes
    IN_PROGRESS --> FAILED: Technical disruption / Call abandoned

    COMPLETED --> [*]
    EXPIRED --> [*]
    CANCELLED --> [*]
    FAILED --> [*]
```

### Saga Compensations & Webhook Replay Deduplication:
- **Transactional Outbox Pattern**: When a slot is held, consultation created, or payment intent generated, domain events are saved to the `outbox_events` table *within the same atomic database transaction*.
- **Payment Deduplication**: Stripe webhooks verify HMAC-SHA256 signatures and insert incoming event IDs into `processed_webhooks` with `ON CONFLICT DO NOTHING`. If a webhook replay occurs, it is immediately acknowledged (HTTP 200) without double-processing.
- **Refund Policy Engine**:
  - Cancellation $> 24\text{ hours}$ before scheduled start: **100% refund**.
  - Cancellation $2 - 24\text{ hours}$ before scheduled start: **50% refund**.
  - Cancellation $< 2\text{ hours}$ before scheduled start: **0% refund (Non-refundable)**.
  - Doctor-initiated cancellation at any time: **100% refund + patient notification**.

---

## 4. Cryptography & Envelope Encryption Architecture

To satisfy HIPAA and GDPR requirements for Protected Health Information (PHI) and Personally Identifiable Information (PII), Amrutam implements **AES-256-GCM Envelope Encryption**:

```mermaid
flowchart LR
    subgraph KMS["AWS Key Management Service (Hardware Security Module)"]
        KEK["Customer Master Key (KEK) v1 / v2"]
    end

    subgraph Application["Amrutam Application Engine"]
        PlainData["Plaintext Clinical Notes / Prescription Items"]
        DataKey["Ephemeral Data Encryption Key (DEK - 256-bit)"]
        AES["AES-256-GCM Encryptor"]
        Ciphertext["Ciphertext + 96-bit IV + 128-bit Auth Tag"]
    end

    subgraph Database["PostgreSQL 16 (At-Rest Storage)"]
        EncRecord[("Encrypted Record:
        - encrypted_payload
        - iv
        - auth_tag
        - key_version: 'v1'
        - encrypted_dek")]
    end

    KMS -- GenerateDataKey --> DataKey
    DataKey --> AES
    PlainData --> AES
    AES --> Ciphertext
    Ciphertext --> EncRecord
```

- **Per-Record Isolation**: A unique DEK is generated for every encrypted prescription and clinical note.
- **Key Versioning**: Every encrypted row stores `key_version`. When the master KEK is rotated annually, existing data remains decryptable, and background jobs re-wrap stored DEKs (`CryptoService.reWrap()`) without touching underlying ciphertexts.
- **Log Leakage Prevention**: Pino logger employs recursive field masking on `notes`, `diagnosis`, `items`, `password`, `ssn`, and `token`.

---

## 5. Audit Log Cryptographic Hash-Chaining

All security-sensitive operations (prescription issuance, clinical note access, admin status modifications, KYC approvals) are recorded in an **immutable, append-only audit ledger**:

$$\text{hash}_n = \text{HMAC-SHA256}\left(\text{hash}_{n-1} \,\|\, \text{timestamp} \,\|\, \text{actor\_id} \,\|\, \text{action} \,\|\, \text{payload}\right)$$

```mermaid
flowchart LR
    Genesis["Genesis Block
    prev_hash: '00000000000000000000000000000000'"]
    Row1["Audit Event #1
    hash: 'a1b2c3...'"]
    Row2["Audit Event #2
    hash: 'd4e5f6...'"]
    Row3["Audit Event #3
    hash: '7g8h9i...'"]

    Genesis --> Row1 --> Row2 --> Row3
```

- **Database-Level Immutability**: PostgreSQL `BEFORE UPDATE OR DELETE` triggers unconditionally raise SQL exceptions, preventing any tampering even by database administrators.
- **Verification API**: `GET /api/v1/audit/verify` re-computes the cryptographic chain from genesis to head, immediately detecting any row injection, deletion, or modification.

---

## 6. Observability, Metrics & Multi-Window Burn-Rate Alerting

The platform implements Google SRE multi-window, multi-burn-rate alerting for a **99.95% Availability SLO** ($\approx 21.6\text{ minutes}$ monthly error budget):

| Alert Severity | Burn Rate | 99.95% Budget Consumed | Time Window | Detection Latency | Notification Channel |
|---|---|---|---|---|---|
| **Critical (Page)** | **14.4x** | 2.0% in 1 hour | 1 hour | ~2 minutes | PagerDuty / On-Call Engineer |
| **High (Ticket)** | **6.0x** | 5.0% in 6 hours | 6 hours | ~15 minutes | DevOps Slack Channel |
| **Medium (Log)** | **1.0x** | 10.0% in 3 days | 3 days | ~2 hours | Weekly Engineering Review |

Prometheus RED metrics (`http_requests_total`, `http_request_duration_seconds`), database pool saturation gauges, and BullMQ queue depths are scraped via `/api/v1/metrics` and visualized on provisioned Grafana dashboards.

---

## 7. Disaster Recovery & Backup Runbook

- **RPO (Recovery Point Objective)**: $\le 5\text{ minutes}$ via PostgreSQL Continuous Write-Ahead Log (WAL) archiving and AWS RDS 35-day Point-In-Time-Recovery (PITR).
- **RTO (Recovery Time Objective)**: $\le 30\text{ minutes}$ via automated Terraform infrastructure provisioning and multi-AZ failovers.
- **Cross-Region DR**: Automated daily snapshots copied asynchronously to `ap-southeast-1` (Singapore) with KMS key alias re-encryption.
