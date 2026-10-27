# [ADR-0002] Modular Monolith with Dedicated Worker Process

* Status: Accepted
* Date: 2026-10-27
* Deciders: Backend Engineering Team
* Consulted: PRD §3 (D2), PRD §6.1
* Informed: All Engineers

## Context and Problem Statement
The assignment requires a clean, scalable design separating HTTP request handling from asynchronous background tasks (notification dispatch, prescription PDF rendering, analytics aggregation, hold expiration, saga reconciliation). We need an architectural topology that avoids microservices deployment overhead while enforcing clean boundaries.

## Decision Drivers
* Strict boundary enforcement: modules must not access other modules' tables directly.
* Rapid development and simplified local/container deployment (`docker compose up`).
* Independent scalability of the web tier (`api`) and background job processors (`worker`).
* Fault isolation: heavy async jobs must never starve or crash HTTP request listeners.

## Considered Options
1. **Modular Monolith codebase with dual runtime entrypoints (`main.ts` for API, `worker.ts` for BullMQ workers)**
2. Microservices with separate repositories or polyrepo orchestration
3. Single process running both HTTP server and background queues together

## Decision Outcome
Chosen option: **Option 1 (Modular Monolith with dual runtime entrypoints)**.

### Architecture:
* **Single codebase** organized by domain modules (`auth`, `users`, `doctors`, `availability`, `bookings`, `consultations`, `prescriptions`, `payments`, `search`, `audit`, `analytics`).
* **`main.ts`**: Boots Fastify NestJS application, serves REST endpoints, registers HTTP routes and middleware.
* **`worker.ts`**: Boots BullMQ workers listening on Redis queues for outbox event delivery, PDF rendering, slot hold expiration, and analytics rollups.
* **Module isolation**: Modules interact only via exported NestJS service interfaces or domain events published to the transactional outbox.

## Validation & Compliance
* Containerized in `docker-compose.yml` with distinct `api` and `worker` services.
* Unit and integration tests verify no cross-module database foreign dependencies.
