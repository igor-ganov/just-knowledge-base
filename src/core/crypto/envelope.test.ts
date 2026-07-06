import { describe, expect, test } from 'bun:test';
import { utf8Decode, utf8Encode } from './bytes';
import { openRecord, sealRecord } from './envelope';

const testKey = (): Promise<CryptoKey> =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

describe('crypto envelope (NFR-1, AC-6.5)', () => {
  test('seals and opens a record bound to its path', async () => {
    const key = await testKey();
    const sealed = await sealRecord(key, 'notes/abc/1.bin', utf8Encode('secret text'));
    const opened = await openRecord(key, 'notes/abc/1.bin', sealed);
    expect(utf8Decode(opened)).toBe('secret text');
  });

  test('rejects tampered ciphertext', async () => {
    const key = await testKey();
    const sealed = await sealRecord(key, 'p', utf8Encode('data'));
    const tampered = sealed.slice();
    const target = 20 % tampered.length;
    tampered[target] = (tampered[target] ?? 0) ^ 0xff;
    expect(openRecord(key, 'p', tampered)).rejects.toBeDefined();
  });

  test('rejects a blob moved to a different record path (AAD binding)', async () => {
    const key = await testKey();
    const sealed = await sealRecord(key, 'notes/a/1.bin', utf8Encode('data'));
    expect(openRecord(key, 'notes/b/1.bin', sealed)).rejects.toBeDefined();
  });

  test('produces distinct ciphertexts for identical plaintext (fresh nonces)', async () => {
    const key = await testKey();
    const first = await sealRecord(key, 'p', utf8Encode('same'));
    const second = await sealRecord(key, 'p', utf8Encode('same'));
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
  });
});
