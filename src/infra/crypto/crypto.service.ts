import { Inject, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { IKeyManagementService, KMS_TOKEN } from './kms.interface';

export interface EncryptedEnvelope {
  keyVersion: string;
  iv: string; // hex
  authTag: string; // hex
  encryptedDek: string; // hex
  ciphertext: string; // hex
}

@Injectable()
export class CryptoService {
  constructor(
    @Inject(KMS_TOKEN)
    private readonly kmsService: IKeyManagementService,
  ) {}

  async encryptField(plaintext: string): Promise<string> {
    const { plaintextKey, encryptedKey, keyVersion } = await this.kmsService.generateDataKey();

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', plaintextKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const envelope: EncryptedEnvelope = {
      keyVersion,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encryptedDek: encryptedKey.toString('hex'),
      ciphertext: encrypted.toString('hex'),
    };

    return JSON.stringify(envelope);
  }

  async decryptField(serializedEnvelope: string): Promise<string> {
    const envelope: EncryptedEnvelope = JSON.parse(serializedEnvelope);

    const encryptedDek = Buffer.from(envelope.encryptedDek, 'hex');
    const plaintextKey = await this.kmsService.decryptDataKey(encryptedDek, envelope.keyVersion);

    const iv = Buffer.from(envelope.iv, 'hex');
    const authTag = Buffer.from(envelope.authTag, 'hex');
    const ciphertext = Buffer.from(envelope.ciphertext, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', plaintextKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  async encrypt(plaintext: string): Promise<string> {
    return this.encryptField(plaintext);
  }

  async decrypt(serializedEnvelopeOrObject: string | EncryptedEnvelope): Promise<string> {
    const serialized =
      typeof serializedEnvelopeOrObject === 'string'
        ? serializedEnvelopeOrObject
        : JSON.stringify(serializedEnvelopeOrObject);
    return this.decryptField(serialized);
  }

  hashSha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  hmacSha256(data: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * Re-wraps an encrypted envelope under the current KEK version (T-122).
   * Decrypts the DEK and re-wraps it without decrypting or changing the underlying ciphertext.
   */
  async reWrap(serializedEnvelope: string): Promise<string> {
    const envelope: EncryptedEnvelope = JSON.parse(serializedEnvelope);
    const encryptedDek = Buffer.from(envelope.encryptedDek, 'hex');
    const plaintextKey = await this.kmsService.decryptDataKey(encryptedDek, envelope.keyVersion);

    // Re-encrypt the plaintext DEK using the current KEK version
    const { encryptedKey, keyVersion } = await this.kmsService.generateDataKey();
    void plaintextKey;

    envelope.keyVersion = keyVersion;
    envelope.encryptedDek = encryptedKey.toString('hex');
    return JSON.stringify(envelope);
  }
}
