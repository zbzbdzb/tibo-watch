import { describe, expect, it } from 'vitest';

import { CredentialStore } from '../../src/main/security/credentialStore';
import { AppDatabase } from '../../src/main/storage/database';

describe('CredentialStore', () => {
  it('round-trips an SMTP password through encrypted bytes only', () => {
    const database = new AppDatabase(':memory:');
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`protected:${[...value].reverse().join('')}`),
      decryptString: (value: Buffer) => [...value.toString().replace('protected:', '')].reverse().join(''),
    };
    const store = new CredentialStore(database, encryption);
    store.setSmtpPassword('secret-value');
    expect(store.getSmtpPassword()).toBe('secret-value');
    expect(database.getEncryptedSecret('smtp-password')?.toString()).not.toContain('secret-value');
    database.close();
  });

  it('refuses to persist plaintext when Windows encryption is unavailable', () => {
    const database = new AppDatabase(':memory:');
    const store = new CredentialStore(database, {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    });
    expect(() => store.setSmtpPassword('secret-value')).toThrow('encryption is unavailable');
    expect(database.getEncryptedSecret('smtp-password')).toBeNull();
    database.close();
  });
});
