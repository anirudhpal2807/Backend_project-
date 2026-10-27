# [ADR-0004] Application-Layer Envelope Encryption and KMS Interface

* Status: Accepted
* Date: 2026-10-27
* Deciders: Backend Engineering Team
* Consulted: PRD §5.3, §5.4, §6.2
* Informed: All Engineers, Security Team

## Context and Problem Statement
Telemedicine systems handle sensitive Protected Health Information (PHI) such as clinical notes, prescription medication details, and patient personal identification (PII). Regulatory best practices and assignment requirements dictate application-level encryption at rest, cryptographic key versioning, and secure key rotation without cloud provider lock-in during local development and testing.

## Decision Drivers
* Defense-in-depth: database compromises or backups should not expose plaintext clinical records.
* Support for cryptographic key rotation without re-encrypting the entire historical database synchronously.
* Clean abstraction to run with local environment keys during development and AWS KMS in production.
* Fast authenticated encryption with integrity protection.

## Considered Options
1. **AES-256-GCM Envelope Encryption via `KeyManagementService` Interface with Key Versioning**
2. Database-level pgcrypto functions with a single static database key
3. Full database volume encryption only (transparent data encryption)

## Decision Outcome
Chosen option: **Option 1 (AES-256-GCM Envelope Encryption via `KeyManagementService`)**.

### Architecture:
* **`KeyManagementService` Interface**:
  - `generateDataKey(keyVersion: string): Promise<{ plaintextKey: Buffer, encryptedKey: Buffer }>`
  - `decryptDataKey(encryptedKey: Buffer, keyVersion: string): Promise<Buffer>`
* **Envelope Encryption Mechanism**:
  - For each sensitive record or batch, a random 256-bit Data Encryption Key (DEK) is generated.
  - The record payload (e.g. prescription items, clinical notes) is encrypted using AES-256-GCM with a unique 96-bit Initialization Vector (IV) and authentication tag.
  - The DEK is encrypted using the Key Encryption Key (KEK) managed by the KMS.
  - The stored database record contains: `{ cipher_text, iv, auth_tag, encrypted_dek, key_version }`.
* **Adapters**:
  - `LocalKeyManagementService`: Uses master 256-bit KEK from environment variables (`MASTER_ENCRYPTION_KEY`) for local Docker/testing.
  - `AwsKmsManagementService`: Uses AWS KMS Customer Master Keys (CMK) via AWS SDK for staging/production.
* **Key Rotation**:
  - When the KEK rotates (e.g. `v1` -> `v2`), all new records are encrypted using `v2`.
  - A background re-wrapping job decrypts the DEK using the old KEK and re-encrypts the DEK with the new KEK, requiring zero modification to the underlying ciphertext payload.

## Validation & Compliance
* Unit tests for AES-256-GCM encryption, decryption, authentication tag validation, and tampering rejection.
* Key rotation integration test verifying decryption of `v1` records after `v2` is introduced.
