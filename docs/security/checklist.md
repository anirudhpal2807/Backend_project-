# OWASP ASVS v4.0 Security Verification Checklist

This document tracks verification evidence for Level 2/3 controls of the OWASP Application Security Verification Standard (ASVS 4.0).

| ASVS ID | Control Category | Requirement Description | Status | Evidence / Implementation Link |
|---|---|---|---|---|
| **V1.1** | Architecture | Explicit trust boundaries between DMZ, application tier, and data tier. | VERIFIED | [threat-model.md](file:///c:/AI_project/Backend_developer/docs/security/threat-model.md#1-system-context-and-trust-boundaries) |
| **V2.1** | Authentication | Password storage uses salted, memory-hard algorithm (Argon2id). | VERIFIED | [auth.service.ts](file:///c:/AI_project/Backend_developer/src/modules/auth/auth.service.ts#L45-L60) |
| **V2.2** | Authentication | Enumeration protection against account existence timing attacks. | VERIFIED | [auth.service.ts](file:///c:/AI_project/Backend_developer/src/modules/auth/auth.service.ts#L85-L100) (Dummy password hash calculation) |
| **V2.8** | Authentication | Multi-factor authentication (MFA) with RFC 6238 TOTP and single-use backup codes. | VERIFIED | [auth.service.ts](file:///c:/AI_project/Backend_developer/src/modules/auth/auth.service.ts#L180-L240) (Enforced for DOCTOR/ADMIN/AUDITOR) |
| **V3.3** | Session Management | Rotating refresh tokens with family reuse revocation detection. | VERIFIED | [auth.service.ts](file:///c:/AI_project/Backend_developer/src/modules/auth/auth.service.ts#L120-L165) |
| **V4.1** | Access Control | Principle of least privilege enforced on every endpoint (Deny-by-default RBAC). | VERIFIED | [roles.guard.ts](file:///c:/AI_project/Backend_developer/src/modules/auth/guards/roles.guard.ts) |
| **V4.2** | Access Control | Ownership assertions prevent Insecure Direct Object References (BOLA/IDOR). | VERIFIED | [prescriptions.service.ts](file:///c:/AI_project/Backend_developer/src/modules/prescriptions/prescriptions.service.ts#L250-L270) |
| **V5.1** | Input Validation | Strict validation using class-validator DTOs and Zod environment schema. | VERIFIED | [config.schema.ts](file:///c:/AI_project/Backend_developer/src/infra/config/config.schema.ts) |
| **V5.3** | Input Validation | All database queries parameterized; zero dynamic SQL concatenation. | VERIFIED | [database.service.ts](file:///c:/AI_project/Backend_developer/src/infra/db/database.service.ts) |
| **V6.2** | Cryptography | Field-level AES-256-GCM envelope encryption with per-record DEK and KMS key versioning. | VERIFIED | [crypto.service.ts](file:///c:/AI_project/Backend_developer/src/infra/crypto/crypto.service.ts) |
| **V7.1** | Error Handling | Standardized RFC 7807 Problem Details error envelopes with error codes. | VERIFIED | [global-exception.filter.ts](file:///c:/AI_project/Backend_developer/src/common/filters/global-exception.filter.ts) |
| **V8.2** | Data Protection | Automatic redaction of PHI/PII, credentials, and tokens in application logs. | VERIFIED | [redaction.util.ts](file:///c:/AI_project/Backend_developer/src/common/logger/redaction.util.ts) |
| **V9.1** | Communications | TLS 1.3 encryption in transit with Strict-Transport-Security (HSTS). | VERIFIED | [main.ts](file:///c:/AI_project/Backend_developer/src/main.ts) |
| **V10.1**| Malicious Code | Non-root container execution (`node` user) in multi-stage Docker build. | VERIFIED | [Dockerfile](file:///c:/AI_project/Backend_developer/Dockerfile) |
| **V14.2**| Configuration | Security headers configured via Helmet (CSP, frameguard, X-Content-Type-Options). | VERIFIED | [main.ts](file:///c:/AI_project/Backend_developer/src/main.ts) |
