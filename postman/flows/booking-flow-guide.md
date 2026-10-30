# Postman Flows — End-to-End Booking Saga

This workflow describes the multi-step execution graph across personas:
1. **Trigger**: Patient registers or authenticates.
2. **Action**: Queries open availability slots for verified Ayurvedic doctor.
3. **Branch**: Holds slot (`POST /bookings/hold`) with atomic 10-minute hold window.
4. **Payment Node**: Creates Cashfree / Mock payment intent with ₹800 consultation fee.
5. **Webhook Node**: Simulates payment gateway webhook signature.
6. **Confirmation**: Saga reconciles, marks consultation `CONFIRMED`, books slot, issues audit log.

