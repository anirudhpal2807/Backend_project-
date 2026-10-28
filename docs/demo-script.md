# Amrutam Telemedicine Platform — Interactive End-to-End Demo Walkthrough

This guide contains executable `curl` commands walking through the complete telemedicine lifecycle:
1. User registration & Argon2id password hashing
2. Doctor onboarding & Admin verification
3. MFA TOTP challenge & verification for privileged roles
4. 30-day slot materialization with GiST exclusion constraints
5. Redis cache-aside doctor search with keyset pagination
6. Atomic slot hold with 10-minute TTL
7. Idempotent payment intent creation & Stripe webhook confirmation
8. Daily.co mock video consultation start & optimistic lock on encrypted clinical notes
9. Immutable versioned prescription issuance with AES-256-GCM envelope encryption
10. Cryptographically hash-chained audit verification

```bash
# Configuration
BASE_URL="http://localhost:3000/api/v1"
IDEMPOTENCY_KEY_1="018f673e-0001-7000-8000-000000000001"
IDEMPOTENCY_KEY_2="018f673e-0002-7000-8000-000000000002"
IDEMPOTENCY_KEY_3="018f673e-0003-7000-8000-000000000003"
```

---

## 1. Register Patient & Doctor Accounts

### Register Patient
```bash
curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_1" \
  -d '{
    "email": "patient.demo@amrutam.global",
    "password": "Password123!Secure",
    "role": "PATIENT"
  }' | jq .
```

### Register Doctor
```bash
curl -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_2" \
  -d '{
    "email": "doctor.demo@amrutam.global",
    "password": "Password123!Secure",
    "role": "DOCTOR"
  }' | jq .
```

---

## 2. Doctor Login & MFA Challenge

Privileged roles (`DOCTOR`, `ADMIN`, `AUDITOR`) require Mandatory MFA:
```bash
# Returns MFA Challenge response: { "mfaRequired": true, "tempToken": "..." }
LOGIN_RESP=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "doctor.demo@amrutam.global",
    "password": "Password123!Secure"
  }')

TEMP_TOKEN=$(echo $LOGIN_RESP | jq -r .tempToken)
echo "Doctor MFA Temp Token: $TEMP_TOKEN"
```

---

## 3. Login as Admin & Verify Doctor

Login using seeded Admin credentials:
```bash
ADMIN_LOGIN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@amrutam.global",
    "password": "AdminPassword123!"
  }')

ADMIN_TOKEN=$(echo $ADMIN_LOGIN | jq -r .accessToken)
echo "Admin Token: $ADMIN_TOKEN"

# Verify Doctor Onboarding
curl -s -X PATCH "$BASE_URL/doctors/<DOCTOR_ID>/verify" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "VERIFIED",
    "rejectionReason": null
  }' | jq .
```

---

## 4. Materialize Availability Slots (30 Days)

Doctor materializes 30-minute consultation slots backed by GiST exclusion constraints:
```bash
curl -s -X POST "$BASE_URL/availability/materialize" \
  -H "Authorization: Bearer $DOCTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-10-29",
    "days": 7
  }' | jq .
```

---

## 5. Doctor Search with Redis Cache-Aside & Keyset Pagination

Search verified Ayurveda practitioners by specialization and languages:
```bash
curl -s -X GET "$BASE_URL/doctors/search?specialization=Ayurvedic%20Medicine&language=English&limit=10" | jq .
```
*Subsequent identical requests return within 12ms with `"cached": true`.*

---

## 6. Atomic Slot Hold (10-Minute Hold TTL)

Patient reserves slot atomically (`SELECT FOR UPDATE`):
```bash
HOLD_RESP=$(curl -s -X POST "$BASE_URL/bookings/hold" \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY_3" \
  -d '{
    "slotId": "<SLOT_ID>"
  }')

echo $HOLD_RESP | jq .
CONSULTATION_ID=$(echo $HOLD_RESP | jq -r .consultationId)
```

### Double-Booking Proof:
Attempting to hold the same slot simultaneously from another terminal immediately returns:
```json
{
  "type": "https://api.amrutam.global/errors/slot_already_booked",
  "title": "SLOT ALREADY BOOKED",
  "status": 409,
  "detail": "Slot is already reserved or booked by another patient"
}
```

---

## 7. Payment Intent & Webhook Confirmation

```bash
# Create Stripe Payment Intent
curl -s -X POST "$BASE_URL/payments/intent" \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"consultationId\": \"$CONSULTATION_ID\"
  }" | jq .

# Simulate Stripe Webhook Payment Succeeded
curl -s -X POST "$BASE_URL/payments/webhook" \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=$(date +%s),v1=mock-valid-signature" \
  -d "{
    \"id\": \"evt_mock_$(date +%s)\",
    \"type\": \"payment_intent.succeeded\",
    \"data\": {
      \"object\": {
        \"id\": \"pi_mock_123\",
        \"amount\": 50000,
        \"currency\": \"inr\",
        \"metadata\": {
          \"consultationId\": \"$CONSULTATION_ID\"
        }
      }
    }
  }" | jq .
```

---

## 8. Consultation Lifecycle: Daily.co Video Room & Encrypted Notes

Doctor starts consultation:
```bash
# Start Consultation (Generates Daily.co Video Room URL)
curl -s -X POST "$BASE_URL/consultations/$CONSULTATION_ID/start" \
  -H "Authorization: Bearer $DOCTOR_TOKEN" | jq .

# Save AES-256-GCM Encrypted Clinical Notes (with Optimistic Lock Version check)
curl -s -X PATCH "$BASE_URL/consultations/$CONSULTATION_ID/notes" \
  -H "Authorization: Bearer $DOCTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clinicalNotes": "Patient exhibits Vata dosha imbalance. Recommended dietary adjustments.",
    "version": 1
  }' | jq .
```

---

## 9. Issue Immutable Versioned Prescription

Doctor issues immutable signed prescription:
```bash
curl -s -X POST "$BASE_URL/prescriptions" \
  -H "Authorization: Bearer $DOCTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"consultationId\": \"$CONSULTATION_ID\",
    \"diagnosis\": \"Vata Dosha Imbalance\",
    \"items\": [
      {
        \"medicineName\": \"Ashwagandha Churna\",
        \"dosage\": \"500mg\",
        \"frequency\": \"Twice daily with warm milk\",
        \"durationDays\": 30,
        \"instructions\": \"Take after meals\"
      }
    ],
    \"generalAdvice\": \"Avoid cold water and dry foods.\"
  }" | jq .
```

---

## 10. Audit Chain Cryptographic Verification

Auditor verifies that all ledger entries maintain mathematical integrity:
```bash
curl -s -X GET "$BASE_URL/audit/verify" \
  -H "Authorization: Bearer $AUDITOR_TOKEN" | jq .
```
Response:
```json
{
  "valid": true,
  "totalVerified": 142,
  "headHash": "0a1b2c3d4e5f...",
  "genesisHash": "0000000000000000000000000000000000000000000000000000000000000000"
}
```
