# Operational Runbook: Cryptographic Key Compromise & Rotation

## 1. Trigger Conditions
- Suspected leakage of JWT signing key or Master Encryption Key (KEK).
- Scheduled annual key rotation audit event.

---

## 2. Emergency JWT Signing Key Rotation (Zero-Downtime Grace Period)

1. Generate a new 256-bit secret for `JWT_SECRET_V2`.
2. Update AWS Secrets Manager secret `amrutam/jwt_secrets`:
   ```json
   {
     "active_kid": "v2",
     "keys": {
       "v1": "<OLD_COMPROMISED_KEY>",
       "v2": "<NEW_SECURE_KEY>"
     }
   }
   ```
3. Application immediately signs new tokens with `kid: v2`.
4. Verification accepts both `v1` and `v2` during a 15-minute grace period (token lifetime).
5. After 15 minutes, purge `v1` from Secrets Manager and revoke all active refresh token families:
   ```sql
   UPDATE refresh_tokens SET is_revoked = true, updated_at = NOW();
   ```

---

## 3. Envelope Encryption Master Key (KEK) Rotation

1. Create a new KMS key version in AWS KMS:
   ```bash
   aws kms enable-key-rotation --key-id "alias/amrutam-prod-phi-kek"
   ```
2. Set application environment `ENCRYPTION_KEY_VERSION=v2`.
3. Existing records with `key_version = 'v1'` continue decrypting cleanly using the embedded `key_version` tag.
4. Trigger background re-wrapping job for existing DEKs:
   ```bash
   npm run rewrap-keys
   ```
   *`CryptoService.reWrap()` re-encrypts stored DEKs under KEK v2 without modifying encrypted clinical ciphertexts.*
