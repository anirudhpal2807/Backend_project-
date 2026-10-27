import { CryptoService, EncryptedEnvelope } from '../../src/infra/crypto/crypto.service';
import { LocalKmsService } from '../../src/infra/crypto/local-kms.service';
import { AppConfigService } from '../../src/infra/config/config.service';

describe('Envelope Encryption & KMS (T-035)', () => {
  let cryptoService: CryptoService;

  beforeEach(() => {
    const mockConfig = {
      get: (key: string) => {
        if (key === 'MASTER_ENCRYPTION_KEY') {
          return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        }
        if (key === 'ENCRYPTION_KEY_VERSION') {
          return 'v1';
        }
        return '';
      },
    } as unknown as AppConfigService;

    const kmsService = new LocalKmsService(mockConfig);
    cryptoService = new CryptoService(kmsService);
  });

  it('encrypts and decrypts sensitive clinical text preserving exact content', async () => {
    const sensitiveData = 'Patient has chronic dyspepsia; prescribed Triphala 500mg.';
    const encrypted = await cryptoService.encryptField(sensitiveData);

    expect(encrypted).not.toContain(sensitiveData);
    expect(JSON.parse(encrypted)).toHaveProperty('keyVersion', 'v1');

    const decrypted = await cryptoService.decryptField(encrypted);
    expect(decrypted).toBe(sensitiveData);
  });

  it('fails decryption and throws authentication error when ciphertext is tampered', async () => {
    const sensitiveData = 'Sensitive PHI';
    const encryptedJson = await cryptoService.encryptField(sensitiveData);
    const envelope: EncryptedEnvelope = JSON.parse(encryptedJson);

    // Tamper with the ciphertext (flip a byte)
    const tamperedCipher = 'ff' + envelope.ciphertext.slice(2);
    envelope.ciphertext = tamperedCipher;

    await expect(cryptoService.decryptField(JSON.stringify(envelope))).rejects.toThrow();
  });

  it('fails decryption and throws authentication error when authTag is tampered', async () => {
    const sensitiveData = 'Sensitive PHI';
    const encryptedJson = await cryptoService.encryptField(sensitiveData);
    const envelope: EncryptedEnvelope = JSON.parse(encryptedJson);

    // Tamper with auth tag
    envelope.authTag = '00'.repeat(16);

    await expect(cryptoService.decryptField(JSON.stringify(envelope))).rejects.toThrow();
  });
});
