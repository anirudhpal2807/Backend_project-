# [ADR-0001] Core Technology Stack: Node.js 20, TypeScript, NestJS with Fastify, PostgreSQL 16, Redis 7

* Status: Accepted
* Date: 2026-10-27
* Deciders: Backend Engineering Team
* Consulted: Assignment Guidelines, PRD §3 (D1, D3, D5)
* Informed: All Engineers

## Context and Problem Statement
Amrutam telemedicine backend requires high throughput (100k daily consultations), low read latency (p95 <200ms), low write latency (p95 <500ms), 99.95% availability, and strict type safety and architectural modularity. We need to select the runtime, framework, primary datastore, and caching layer to satisfy these requirements while meeting a 4–5 day development timeframe.

## Decision Drivers
* Strict dependency injection and modular boundaries (required by assignment rubric).
* Low overhead and high request throughput for REST APIs.
* Advanced relational constraints (Postgres exclusion constraints on ranges, partial unique indexes for double-booking prevention).
* Robust background job processing and distributed rate-limiting.
* Strong type-safety across database queries and application DTOs.

## Considered Options
1. **Node.js 20 + TypeScript + NestJS (Fastify adapter) + PostgreSQL 16 + Redis 7 + Kysely**
2. Go (Gin/Echo) + GORM/sqlc + PostgreSQL + Redis
3. Python 3.12 + FastAPI + SQLAlchemy + Celery + PostgreSQL

## Decision Outcome
Chosen option: **Option 1 (Node.js 20 + TypeScript + NestJS with Fastify, PostgreSQL 16, Redis 7, Kysely query builder)**.

### Rationale:
* **NestJS** provides enterprise-grade modular architecture with built-in Dependency Injection (DI), guards, interceptors, and exception filters out of the box.
* **Fastify adapter** provides 2x-3x higher HTTP throughput and lower overhead compared to Express, ensuring p95 < 200ms API responses.
* **PostgreSQL 16** is the industry standard system-of-record, supporting required exclusion constraints (`btree_gist`), range types (`tstzrange`), and declarative table partitioning.
* **Kysely** provides type-safe, compile-time verified SQL queries without the performance degradation, hidden queries, or DDL abstraction limitations of heavy ORMs (such as Prisma or TypeORM).
* **Redis 7** delivers sub-millisecond cache-aside reads, distributed token-bucket rate limiting, and BullMQ backing for async queues.

## Validation & Compliance
* Benchmarked in CI via k6 load tests against p95 targets.
* Strict TypeScript compiler mode (`strict: true`, no `any`).
* Database migrations managed via `node-pg-migrate`.
