# Amrutam Telemedicine Platform — Postman API Documentation

## Quick Start
1. **Import Collection**: Import `postman/collections/Amrutam_Telemedicine_Platform.postman_collection.json` into Postman.
2. **Import Environment**: Import `postman/environments/Amrutam_Telemedicine.postman_environment.json`.
3. **Select Environment**: Choose **"Amrutam Telemedicine - Localhost"** from the top-right environment selector.
4. **Base URL**: Defaults to `http://localhost:3000/api/v1`.

## Authentication Workflows
- **Patient**: Direct registration & login (`POST /auth/register`, `POST /auth/login`).
- **Doctor / Admin / Auditor**: Requires TOTP MFA challenge resolution (`POST /auth/mfa/verify-login`) with demo code `123456`.
- Access tokens expire in 15 minutes; refresh tokens automatically rotate via `POST /auth/refresh-token`.

## Core Telemedicine Saga
1. **Discover**: `GET /doctors/search?specialization=Ayurveda&language=English`
2. **View Slots**: `GET /availability/doctors/{doctorId}/slots`
3. **Hold Slot**: `POST /bookings/hold` (Returns Consultation ID with 10-minute saga TTL)
4. **Payment Intent**: `POST /payments/intent` (Cashfree PG v3 Sandbox order with Drop-In session)
5. **Simulate Webhook**: `POST /payments/webhook` with Cashfree/Stripe HMAC signature
6. **Consultation Room**: `GET /consultations/{consultationId}/room` (WebRTC room + token)
7. **Prescription**: `POST /prescriptions/issue` (AES-256-GCM envelope encrypted clinical record)
8. **Audit Verification**: `GET /audit/verify-chain?limit=100` (Cryptographic Merkle hash chain check)

