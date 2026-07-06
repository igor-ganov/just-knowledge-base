import { concatBytes, exactBuffer, randomBytes, utf8Encode } from './bytes';

/**
 * AEAD envelope: `nonce(12) ‖ ciphertext+tag`.
 * AAD binds each record to its logical path inside the vault so a blob moved
 * or swapped within the repository fails authentication (design §2.3).
 */
const NONCE_LENGTH = 12;
const FORMAT_VERSION = 1;

const aadFor = (recordPath: string): ArrayBuffer =>
  exactBuffer(utf8Encode(`jkb:v${FORMAT_VERSION}:${recordPath}`));

export const sealRecord = async (
  key: CryptoKey,
  recordPath: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> => {
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: exactBuffer(nonce), additionalData: aadFor(recordPath) },
    key,
    exactBuffer(plaintext),
  );
  return concatBytes(nonce, new Uint8Array(ciphertext));
};

export const openRecord = async (
  key: CryptoKey,
  recordPath: string,
  sealed: Uint8Array,
): Promise<Uint8Array> => {
  const nonce = sealed.subarray(0, NONCE_LENGTH);
  const ciphertext = sealed.subarray(NONCE_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: exactBuffer(nonce), additionalData: aadFor(recordPath) },
    key,
    exactBuffer(ciphertext),
  );
  return new Uint8Array(plaintext);
};
