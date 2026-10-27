# [ADR-0003] Booking Flow Saga Orchestration with Transactional Outbox

* Status: Accepted
* Date: 2026-10-27
* Deciders: Backend Engineering Team
* Consulted: PRD §4.2, §4.7, §6.4
* Informed: All Engineers

## Context and Problem Statement
Booking a medical appointment involves multiple coordinated steps across slots, consultations, third-party payment providers, and notifications. Double-booking must be impossible by construction, and failures during payment or confirmation must cleanly rollback or compensate (e.g. release the slot, issue a refund).

## Decision Drivers
* Zero double-booking under high concurrency (evaluation rubric auto-fail criterion).
* Distributed consistency across asynchronous payment webhooks and slot reservations.
* Prevention of dual-write discrepancies between the database state and message queue.
* Resilient recovery when webhooks arrive out-of-order, delayed, or after hold expiration.

## Considered Options
1. **Orchestrated Saga with Slot Hold, PostgreSQL Partial Index, and Transactional Outbox**
2. 2-Phase Commit (2PC) across database and payment provider
3. Choreography via message broker without central state tracking

## Decision Outcome
Chosen option: **Option 1 (Orchestrated Saga with Slot Hold + Transactional Outbox)**.

### Mechanics:
1. **Hold Phase (`POST /api/v1/bookings`)**:
   - Executes in a single PostgreSQL transaction.
   - Atomically transitions slot status from `OPEN` to `HELD` with `held_until = NOW() + 10 minutes`.
   - Inserts `consultation` record in `PENDING_PAYMENT` state.
   - Database constraint: Partial unique index on `consultations(slot_id) WHERE status IN ('PENDING_PAYMENT','CONFIRMED','IN_PROGRESS','COMPLETED')`. This ensures zero double-booking even under 1,000 parallel requests.
   - Atomically records an audit entry and writes a `booking.held` event to the `outbox_events` table in the same transaction.
2. **Payment Phase (`POST /api/v1/payments/intent`)**:
   - Creates an idempotent payment intent with the mock payment provider.
3. **Confirmation Phase (`POST /api/v1/payments/webhook`)**:
   - Verified via HMAC-SHA256 signature and de-duplicated via `processed_webhooks` table.
   - Atomically sets consultation to `CONFIRMED` and slot to `BOOKED`.
4. **Compensation & Expiry**:
   - A scheduled worker job queries for expired holds (`status = 'PENDING_PAYMENT' AND held_until < NOW()`) and resets slots to `OPEN`.
   - If a late payment webhook arrives after hold expiration, a compensating automatic refund is issued.

## Validation & Compliance
* Concurrency integration test with 1,000 parallel booking requests against one slot.
* Webhook replay and tampering negative tests.
