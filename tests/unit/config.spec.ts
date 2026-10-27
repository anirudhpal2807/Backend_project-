import { validateEnv } from '../../src/infra/config/config.schema';

describe('Config Schema Validation (T-011)', () => {
  const validEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    API_PREFIX: 'api/v1',
    LOG_LEVEL: 'info',
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_NAME: 'amrutam_test',
    DB_USER: 'postgres',
    DB_PASSWORD: 'password',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    JWT_SECRET: 'a_very_secure_and_long_jwt_secret_32_chars',
    REFRESH_TOKEN_SECRET: 'a_very_secure_refresh_token_secret_32_chars',
    MASTER_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ENCRYPTION_KEY_VERSION: 'v1',
    PAYMENT_WEBHOOK_SECRET: 'mock-payment-secret-123456',
  };

  it('successfully validates complete valid environment configuration', () => {
    const config = validateEnv(validEnv);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(3000);
    expect(config.DB_HOST).toBe('localhost');
  });

  it('throws a fatal error when critical required variables are missing', () => {
    const invalidEnv = { ...validEnv, DB_HOST: '' };
    expect(() => validateEnv(invalidEnv)).toThrow(/DB_HOST is required/);
  });

  it('rejects short or insecure JWT secrets (<32 chars)', () => {
    const invalidEnv = { ...validEnv, JWT_SECRET: 'too-short' };
    expect(() => validateEnv(invalidEnv)).toThrow(/JWT_SECRET must be at least 32 characters/);
  });

  it('rejects invalid master encryption keys that are not 64-char hex strings', () => {
    const invalidEnv = { ...validEnv, MASTER_ENCRYPTION_KEY: 'invalid_key' };
    expect(() => validateEnv(invalidEnv)).toThrow(
      /MASTER_ENCRYPTION_KEY must be a 64-character hex string/,
    );
  });
});
