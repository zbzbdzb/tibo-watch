import type { AppDatabase } from '../storage/database';

export interface EncryptionAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class CredentialStore {
  constructor(
    private readonly database: AppDatabase,
    private readonly encryption: EncryptionAdapter,
  ) {}

  setSmtpPassword(password: string): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('Windows credential encryption is unavailable');
    }
    this.database.setEncryptedSecret('smtp-password', this.encryption.encryptString(password));
  }

  getSmtpPassword(): string | null {
    const encrypted = this.database.getEncryptedSecret('smtp-password');
    if (!encrypted) return null;
    if (!this.encryption.isEncryptionAvailable()) return null;
    return this.encryption.decryptString(encrypted);
  }
}
