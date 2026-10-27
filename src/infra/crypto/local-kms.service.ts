import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { IKeyManagementService, DataKeyResult } from './kms.interface';
import { AppConfigService } from '../config/config.service';

@Injectable()
export class LocalKmsService implements IKeyManagementService {
  private readonly kek: Buffer;
  private readonly currentVersion: string;

  constructor(private readonly configService: AppConfigService) {
    const hexKey = this.configService.get('MASTER_ENCRYPTION_KEY');
    this.kek = Buffer.from(hexKey, 'hex');
    this.currentVersion = this.configService.get('ENCRYPTION_KEY_VERSION') || 'v1';
  }

  getCurrentKeyVersion(): string {
    return this.currentVersion;
  }

  async generateDataKey(keyVersion?: string): Promise<DataKeyResult> {
    const version = keyVersion || this.currentVersion;
    // Generate random 256-bit (32 bytes) Data Encryption Key (DEK)
    const plaintextKey = crypto.randomBytes(32);

    // Wrap the DEK with the KEK using AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.kek, iv);
    const encrypted = Buffer.concat([cipher.update(plaintextKey), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Pack IV + Tag + Encrypted DEK
    const encryptedKey = Buffer.concat([iv, tag, encrypted]);

    return {
      plaintextKey,
      encryptedKey,
      keyVersion: version,
    };
  }

  async decryptDataKey(encryptedKey: Buffer, keyVersion: string): Promise<Buffer> {
    if (keyVersion !== this.currentVersion && keyVersion !== 'v1') {
      throw new Error(`Unsupported KMS key version: ${keyVersion}`);
    }

    const iv = encryptedKey.subarray(0, 12);
    const tag = encryptedKey.subarray(12, 28);
    const ciphertext = encryptedKey.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.kek, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
