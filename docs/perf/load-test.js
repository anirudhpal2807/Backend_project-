import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Custom Prometheus SLI Metrics
const readLatency = new Trend('read_duration', true);
const writeLatency = new Trend('write_duration', true);
const errorRate = new Rate('error_rate');
const successfulBookings = new Counter('successful_bookings');
const doubleBookingsPrevented = new Counter('double_bookings_prevented');

export const options = {
  scenarios: {
    // Scenario 1: High-Throughput Read Browsing (500 RPS Target)
    browse_doctors_and_slots: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { duration: '30s', target: 200 }, // Warm-up
        { duration: '1m', target: 500 },  // Target 500 RPS Reads (PRD §5)
        { duration: '30s', target: 500 }, // Sustained load
        { duration: '30s', target: 0 },   // Cool-down
      ],
    },

    // Scenario 2: Peak Concurrent Write Booking Flow (150 TPS Target)
    booking_saga_writes: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 300,
      stages: [
        { duration: '30s', target: 50 },  // Ramp-up
        { duration: '1m', target: 150 },  // Target 150 TPS Writes (PRD §5)
        { duration: '30s', target: 150 }, // Peak sustained writes
        { duration: '30s', target: 0 },   // Cool-down
      ],
    },

    // Scenario 3: Spike Test (2x Headroom)
    traffic_spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 200 }, // Rapid burst
        { duration: '30s', target: 200 }, // Hold burst
        { duration: '10s', target: 0 },   // Recovery
      ],
      startTime: '2m30s',
    },
  },

  // SLO Latency & Availability Enforcement Thresholds
  thresholds: {
    read_duration: ['p(95)<200', 'p(99)<500'], // P95 < 200ms Read SLO (docs/slo.md)
    write_duration: ['p(95)<500', 'p(99)<1500'], // P95 < 500ms Write SLO (docs/slo.md)
    error_rate: ['rate<0.0005'], // 99.95% Availability SLO (0.05% error budget)
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000/api/v1';

export default function () {
  const isReadScenario = Math.random() < 0.77; // ~77% reads, ~23% writes matches 500:150 ratio

  if (isReadScenario) {
    group('Read Flow: Search & Availability Slots', () => {
      // 1. Doctor Search with filters
      const searchStart = Date.now();
      const searchRes = http.get(
        `${BASE_URL}/doctors/search?specialization=Ayurveda&languages=Hindi&limit=20`,
        { tags: { type: 'read', name: 'DoctorSearch' } },
      );
      readLatency.add(Date.now() - searchStart);

      const searchSuccess = check(searchRes, {
        'search status is 200': (r) => r.status === 200,
        'search returned items': (r) => JSON.parse(r.body).data !== undefined,
      });
      errorRate.add(!searchSuccess);

      sleep(0.1);

      // 2. Doctor Availability Slot Listing
      const doctorId = '0192e000-0000-7000-8000-000000000002';
      const slotsStart = Date.now();
      const slotsRes = http.get(
        `${BASE_URL}/availability/doctors/${doctorId}/slots?from_date=2026-10-27&to_date=2026-11-26`,
        { tags: { type: 'read', name: 'GetDoctorSlots' } },
      );
      readLatency.add(Date.now() - slotsStart);

      const slotsSuccess = check(slotsRes, {
        'slots status is 200': (r) => r.status === 200,
      });
      errorRate.add(!slotsSuccess);
    });
  } else {
    group('Write Flow: Slot Hold & Idempotent Payment Saga', () => {
      const idempotencyKey = `k6-idemp-${__VU}-${Date.now()}-${Math.random()}`;
      const slotId = '0192e100-0000-7000-8000-000000000001';

      // 1. Hold Slot (Write)
      const holdStart = Date.now();
      const holdPayload = JSON.stringify({
        slot_id: slotId,
        patient_notes: 'K6 Automated Performance Test Consultation',
      });

      const holdRes = http.post(`${BASE_URL}/bookings/hold`, holdPayload, {
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          Authorization: 'Bearer test-token-mock-patient',
        },
        tags: { type: 'write', name: 'HoldSlot' },
      });
      writeLatency.add(Date.now() - holdStart);

      if (holdRes.status === 201) {
        successfulBookings.add(1);
        errorRate.add(0);

        // 2. Confirm Payment via Idempotent Webhook
        const bodyObj = JSON.parse(holdRes.body);
        const bookingId = bodyObj.booking_id;
        const confirmStart = Date.now();

        const webhookPayload = JSON.stringify({
          event_id: `evt_k6_${Date.now()}`,
          booking_id: bookingId,
          amount_inr: 1000,
          status: 'SUCCEEDED',
        });

        const webhookRes = http.post(`${BASE_URL}/payments/webhook`, webhookPayload, {
          headers: {
            'Content-Type': 'application/json',
            'x-amrutam-signature': 'k6-mock-signature',
          },
          tags: { type: 'write', name: 'PaymentWebhook' },
        });
        writeLatency.add(Date.now() - confirmStart);

        check(webhookRes, {
          'webhook processed successfully': (r) => r.status === 200 || r.status === 201,
        });
      } else if (holdRes.status === 409) {
        // Expected outcome for high concurrency on the same slot: Double-Booking correctly prevented!
        doubleBookingsPrevented.add(1);
        errorRate.add(0); // 409 on race condition is correct business behavior, not a 5xx server failure
      } else {
        errorRate.add(1);
      }
    });
  }
}
