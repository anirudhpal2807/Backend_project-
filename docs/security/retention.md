# Data Retention, Erasure, and PHI Compliance Policy

## 1. Regulatory Context and Legal Mandates

The Amrutam Telemedicine Platform operates under strict healthcare, data privacy, and financial regulations:
- **HIPAA Security & Privacy Rules (45 CFR Part 160 & Part 164)**: Mandates administrative, technical, and physical safeguards for Protected Health Information (PHI).
- **DISHA (Digital Information Security in Healthcare Act)** & **Telemedicine Practice Guidelines (2020)**: Mandates confidentiality and statutory preservation of medical records for registered medical practitioners.
- **Indian Medical Council (Professional Conduct, Etiquette and Ethics) Regulations, 2002 (Section 1.3)**: Mandates preservation of indoor/telemedicine medical records for a minimum period of **3 years** from commencement of treatment, extended to **7 years** for statutory compliance and clinical liability defense.
- **GDPR Article 17 (Right to Erasure / Right to be Forgotten)**: Permits data erasure for marketing/profile data, while explicitly creating statutory exceptions (Article 17(3)(b) & 17(3)(h)) for medical treatment records and legal compliance.

---

## 2. Data Classification and Retention Schedules

| Data Category | Examples | Encryption & Protection | Retention Period | Disposal / Anonymization Policy |
|---|---|---|---|---|
| **Clinical Records (PHI)** | Clinical consultation notes, diagnostic assessments, symptoms, prescription items and instructions. | **AES-256-GCM Envelope Encryption** with rotating DEK; strictly zero plaintext stored at rest. | **7 Years** from consultation date. | Cryptographic erasure after statutory period: DEK zeroization renders historical ciphertexts unrecoverable. |
| **Financial & Payment Records** | Payment intents, provider transactions, refund records, invoice references. | Tokenized, masked card numbers, signature-verified webhook proofs. | **7 Years** per statutory tax & financial regulations. | Archival to cold storage; hard deletion after 7 years. |
| **Audit Trails & Access Logs** | SHA-256 hash-chained immutable audit log table (`audit_logs`), request IDs, timestamps, actor IDs, actions. | Append-only database triggers blocking UPDATE/DELETE; SHA-256 cryptographic chain. | **Permanent / Indefinite** (minimum 7 years). | Immutable append-only ledger; never deleted or modified. |
| **User Identity & PII** | Full name, phone number, date of birth, emergency contact, residential address. | Field-level envelope encryption in `profiles`. | Active account lifetime + **30 days** post erasure request. | **Right-to-Erasure Anonymization Flow** via `POST /api/v1/audit/anonymize/:userId`. |
| **Authentication & Session Tokens** | Password hashes (Argon2id), refresh token family hashes, MFA secrets, backup codes. | Argon2id salted hashes, encrypted TOTP secrets. | Valid until expiration or logout/revocation; historical tokens pruned after 90 days. | Automatic database pruning / cascade on account deletion. |

---

## 3. The Anonymization & Right-to-Erasure Procedure

When a patient exercises their statutory Right to Erasure, the platform executes a deterministic two-tier anonymization workflow:

### Tier 1: Scrubbing Direct Identifiers
1. **Profile PII Neutralization**:
   - `first_name` and `last_name` are set to `ANONYMIZED USER`.
   - `phone_encrypted`, `dob_encrypted`, and residential address fields are set to `NULL`.
   - Emergency contact numbers and names are permanently removed.
2. **Account De-identification**:
   - The user's email address is replaced with a pseudo-random hash token (e.g. `anonymized_<uuid>@redacted.amrutam.global`).
   - The account status is set to `SUSPENDED` / `DELETED`.
   - All active JWT refresh token families and MFA secrets are immediately revoked.

### Tier 2: Statutory Record Preservation
- In compliance with medical board regulations and financial auditing rules, historical `consultations`, `payments`, and `prescriptions` retain their foreign key association to the user's UUID.
- Because all profile tables are completely stripped of PII, the UUID is pseudonymized and cannot be correlated with any real-world person.
- An explicit immutable audit event (`user.anonymized`) is appended to the SHA-256 hash chain with the requesting administrator's ID and timestamp.

---

## 4. Cryptographic Key Lifecycle and Cryptographic Erasure

- **Data Encryption Keys (DEK)**: Generated uniquely per record using `crypto.randomBytes(32)` and wrapped by the Key Encryption Key (KEK).
- **Key Versioning**: All encrypted records store the `key_version`. When a KEK is rotated, older records continue decrypting with their versioned key until re-wrapped.
- **Cryptographic Shredding**: Deleting or revoking a DEK renders the corresponding encrypted PHI irrevocably unreadable, meeting DoD 5220.22-M and NIST SP 800-88 sanitization standards without physical disk destruction.

---

## 5. Audit Trail Immutability Verification

All audit logs are protected by:
1. **Database-level immutability triggers**:
   ```sql
   CREATE TRIGGER trg_protect_audit_logs
   BEFORE UPDATE OR DELETE ON audit_logs
   FOR EACH ROW
   EXECUTE FUNCTION prevent_audit_logs_tampering();
   ```
2. **Cryptographic SHA-256 Hash Chaining**:
   Every log entry records `hash = SHA256(prev_hash | id | actor_id | actor_role | action | resource_type | resource_id | outcome | metadata_hash | timestamp)`.
3. **Automated Verification**:
   The compliance team can execute `POST /api/v1/audit/verify-chain` at any time to verify the unbroken ledger integrity from the genesis hash (`000...000`) through the current tip.
