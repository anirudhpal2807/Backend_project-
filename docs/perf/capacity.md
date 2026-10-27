# Capacity Planning & Non-Functional Requirements (NFR) Budget

## 1. Scale Derivation (100k Consultations / Day)

### 1.1 Traffic Metrics
* **Total consultations per day**: 100,000
* **Operational hours**: Telemedicine platform operates 24/7 with peak demand over 12 hours (08:00–20:00).
* **Average write transactions**:
  $$\text{Average Booking Flows/sec} = \frac{100,000}{86,400\text{ s}} \approx 1.16\text{ flows/sec}$$
* **Peak factor**: 10x traffic multiplier during morning doctor availability releases and peak health consult hours.
  $$\text{Peak Booking Flows/sec} = 1.16 \times 10 \approx 12\text{ flows/sec}$$
* **Database Write Amplification**:
  Each completed booking workflow incurs ~10 database writes:
  1. Slot Hold update (`OPEN` -> `HELD`)
  2. Consultation creation (`PENDING_PAYMENT`)
  3. Audit log write (`BOOKING_HOLD`)
  4. Outbox event write (`booking.held`)
  5. Payment intent recording
  6. Webhook deduplication insert
  7. Consultation state transition (`PENDING_PAYMENT` -> `CONFIRMED`)
  8. Slot status transition (`HELD` -> `BOOKED`)
  9. Audit log write (`CONSULTATION_CONFIRMED`)
  10. Outbox event write (`booking.confirmed`)

  $$\text{Peak Database Write TPS} = 12 \times 10 + \text{retries/idempotency} \approx 150\text{ write TPS}$$

### 1.2 Read Traffic & Caching
* **Read-to-Write Ratio**: 20:1 (doctor search, availability slot queries, profile views, consultation history polling).
* **Peak Read RPS**:
  $$\text{Peak Read RPS} = 12 \times 20 = 240\text{ RPS}$$
* **Design & Stress Capacity**: Target **500 RPS** read capacity with 2x headroom tested up to **1,000 RPS**.
* **Cache Hit Strategy**:
  * Doctor public profiles and catalog search: 85% cache hit ratio via Redis (TTL 60s with jitter).
  * Residual read queries to PostgreSQL: ~35–75 read QPS.

---

## 2. Storage Growth Projections

| Entity | Avg Row Size | Daily Growth | Annual Growth (365 Days) | Partitioning Strategy |
| :--- | :--- | :--- | :--- | :--- |
| `consultations` | 1.5 KB | 100,000 rows (~150 MB) | 36.5 Million rows (~55 GB) | Monthly Range (`scheduled_at`) |
| `availability_slots`| 250 Bytes | 200,000 rows (~50 MB) | 73 Million rows (~18 GB) | Monthly Range (`start_at`) |
| `prescriptions` | 4.0 KB (encrypted) | 90,000 rows (~360 MB) | 32.8 Million rows (~131 GB) | Relational FK to consultation |
| `payments` | 1.0 KB | 100,000 rows (~100 MB) | 36.5 Million rows (~36.5 GB) | Indexed by consultation & status |
| `audit_logs` | 800 Bytes | 800,000 rows (~640 MB) | 292 Million rows (~233 GB) | Monthly Range (`created_at`) |
| **Total Annual DB Growth**| — | **~1.3 GB / day** | **~473.5 GB / year** (excluding WAL) | Table & Index Partitioning |

---

## 3. Infrastructure Sizing (AWS Target)

### 3.1 Primary Database (PostgreSQL 16 Multi-AZ)
* **Instance**: `db.r6g.xlarge` (4 vCPU, 32 GB RAM, 12.5 Gbps network)
* **Storage**: 1 TB gp3 (3,000 IOPS baseline, burstable to 12,000 IOPS, 250 MB/s throughput)
* **Connection Pooling**:
  * PostgreSQL `max_connections`: 300
  * Application pool per API instance: `min = 2, max = 20`
  * Total across 4 API ECS tasks + 2 workers: ~120 connections (safe 40% pool utilization).

### 3.2 Redis 7 (ElastiCache / Cluster Mode)
* **Instance**: `cache.m6g.large` (2 vCPU, 6.38 GB RAM)
* **Usage**:
  * Doctor search cache & catalog: ~1.5 GB
  * BullMQ job queue metadata: ~500 MB
  * Sliding-window rate limit counters: ~250 MB
  * Distributed locks & idempotency caches: ~500 MB
  * Memory ceiling: <50% max memory policy (`allkeys-lru`).

### 3.3 Compute (API & Worker)
* **API Service**: AWS ECS Fargate, 4 tasks auto-scaling to 10 on CPU > 70% (1 vCPU, 2 GB RAM each).
* **Worker Service**: AWS ECS Fargate, 2 tasks auto-scaling on BullMQ queue depth (1 vCPU, 2 GB RAM each).

---

## 4. Latency Budget Allocation (per Layer)

### 4.1 Read Requests (Target: p95 < 200ms)
| Hop / Subsystem | Cache Hit (p95) | Cache Miss / DB (p95) |
| :--- | :--- | :--- |
| Client Network + DNS | 40ms | 40ms |
| ALB + TLS Termination | 10ms | 10ms |
| Fastify + NestJS Middleware & Auth Guard | 8ms | 8ms |
| Redis Cache Lookup | 3ms | — |
| PostgreSQL Query (Index Scan / Trigram) | — | 45ms |
| Data Serialization + DTO formatting | 5ms | 8ms |
| **Total End-to-End Latency** | **~66ms** | **~111ms** (Well below 200ms budget) |

### 4.2 Write Requests (Target: p95 < 500ms)
| Subsystem / Operation | Allocated Budget (p95) |
| :--- | :--- |
| Network Ingress + ALB + TLS | 50ms |
| Input Validation (Zod/class-validator) | 5ms |
| Idempotency Check (Redis / DB lookup) | 10ms |
| Envelope Encryption (AES-256-GCM + DEK wrap) | 15ms |
| PostgreSQL Transaction (Slot Hold + Consultation + Outbox + Audit) | 65ms |
| Commit & Outbox Write | 20ms |
| Response Serialization | 5ms |
| Outbound Network Egress | 50ms |
| **Total End-to-End Write Latency** | **~220ms** (Well below 500ms budget) |
