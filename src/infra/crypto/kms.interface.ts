export interface DataKeyResult {
  plaintextKey: Buffer;
  encryptedKey: Buffer;
  keyVersion: string;
}

export interface IKeyManagementService {
  generateDataKey(keyVersion?: string): Promise<DataKeyResult>;
  decryptDataKey(encryptedKey: Buffer, keyVersion: string): Promise<Buffer>;
  getCurrentKeyVersion(): string;
}

export const KMS_TOKEN = Symbol('KMS_TOKEN');
