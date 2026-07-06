import { argon2id } from 'hash-wasm';
import { concatBytes, exactBuffer, fromBase64, randomBytes, toBase64, utf8Encode } from './bytes';

export type KdfParams = {
  readonly algo: 'argon2id';
  readonly saltB64: string;
  readonly memoryKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
};

export type VaultManifest = {
  readonly formatVersion: 1;
  readonly kdf: KdfParams;
  readonly wrappedDekB64: string;
  readonly createdAt: string;
};

/** OWASP-current interactive parameters (design §2.3); tunable per vault. */
export const defaultKdfParams = (): KdfParams => ({
  algo: 'argon2id',
  saltB64: toBase64(randomBytes(16)),
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 4,
});

const DEK_AAD = utf8Encode('jkb:v1:vault.json#dek');
const NONCE_LENGTH = 12;

/** Master password → KEK. Raw bytes are imported non-extractable and dropped. */
export const deriveKek = async (password: string, params: KdfParams): Promise<CryptoKey> => {
  const rawKey = await argon2id({
    password,
    salt: fromBase64(params.saltB64),
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', exactBuffer(rawKey), { name: 'AES-GCM' }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
};

export type CreatedVaultKeys = {
  readonly dek: CryptoKey;
  readonly wrappedDekB64: string;
};

/** Fresh random DEK, wrapped by the KEK. The usable handle is non-extractable. */
export const createDek = async (kek: CryptoKey): Promise<CreatedVaultKeys> => {
  const wrappable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const nonce = randomBytes(NONCE_LENGTH);
  const wrapped = await crypto.subtle.wrapKey('raw', wrappable, kek, {
    name: 'AES-GCM',
    iv: exactBuffer(nonce),
    additionalData: exactBuffer(DEK_AAD),
  });
  const wrappedDekB64 = toBase64(concatBytes(nonce, new Uint8Array(wrapped)));
  const dek = await unwrapDek(kek, wrappedDekB64);
  return { dek, wrappedDekB64 };
};

/**
 * Unwrap the DEK as a NON-extractable key. A wrong password produces a KEK
 * that fails GCM authentication here — the single, uniform failure point (AC-1.3).
 */
export const unwrapDek = async (kek: CryptoKey, wrappedDekB64: string): Promise<CryptoKey> => {
  const sealed = fromBase64(wrappedDekB64);
  const nonce = sealed.subarray(0, NONCE_LENGTH);
  const wrapped = sealed.subarray(NONCE_LENGTH);
  return crypto.subtle.unwrapKey(
    'raw',
    exactBuffer(wrapped),
    kek,
    { name: 'AES-GCM', iv: exactBuffer(nonce), additionalData: exactBuffer(DEK_AAD) },
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
};
