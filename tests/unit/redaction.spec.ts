import { redactSensitiveData } from '../../src/common/logger/redaction.util';

describe('Log Redaction Utility (T-039)', () => {
  it('redacts password, secrets, and auth tokens from log objects', () => {
    const rawPayload = {
      userId: 'usr-123',
      email: 'patient@example.com',
      password: 'SuperSecretPassword123!',
      password_hash: '$argon2id$v=19$m=65536...',
      authorization: 'Bearer eyJhbGciOi...',
      jwt_secret: 'master-secret-key',
    };

    const redacted = redactSensitiveData(rawPayload) as typeof rawPayload;

    expect(redacted.userId).toBe('usr-123');
    expect(redacted.email).toBe('patient@example.com');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.password_hash).toBe('[REDACTED]');
    expect(redacted.authorization).toBe('[REDACTED]');
    expect(redacted.jwt_secret).toBe('[REDACTED]');
  });

  it('redacts nested Protected Health Information (PHI)', () => {
    const consultationData = {
      consultationId: 'c-456',
      diagnosis: 'Hypertension',
      clinical_notes: 'Patient exhibits systolic BP of 150mmHg...',
      prescription: {
        items_encrypted: 'cipher-text-data',
        instructions_encrypted: 'take 1 tablet after meals',
      },
    };

    const redacted = redactSensitiveData(consultationData) as {
      consultationId: string;
      clinical_notes: string;
      prescription: {
        items_encrypted: string;
        instructions_encrypted: string;
      };
    };

    expect(redacted.consultationId).toBe('c-456');
    expect(redacted.clinical_notes).toBe('[REDACTED]');
    expect(redacted.prescription.items_encrypted).toBe('[REDACTED]');
    expect(redacted.prescription.instructions_encrypted).toBe('[REDACTED]');
  });
});
