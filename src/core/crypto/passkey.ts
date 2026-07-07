import { exactBuffer, fromBase64, randomBytes, toBase64, utf8Encode } from './bytes';
import type { PasskeyProtectorRecord } from './keys';

/**
 * Passkey protector (design §2.3, AC-1.0): a WebAuthn credential with the PRF
 * extension. `prf.eval(salt)` returns a 32-byte credential-bound secret;
 * HKDF-SHA-256 turns it into a non-extractable AES-GCM KEK that wraps the same
 * DEK the password protector wraps. The manifest stores only the credential id
 * and the PRF salt — useless without the authenticator ceremony.
 */
const RP_NAME = 'just-knowledge-base';
const HKDF_SALT = utf8Encode('jkb:v1:passkey-kek');

export type EnrolledPasskey = {
  readonly credentialIdB64: string;
  readonly prfSaltB64: string;
  readonly kek: CryptoKey;
};

export const passkeySupported = async (): Promise<boolean> => {
  if (typeof PublicKeyCredential === 'undefined') return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

/** PRF output → KEK. Exported for unit tests; pure WebCrypto, no WebAuthn. */
export const kekFromPrfOutput = async (prfOutput: ArrayBuffer): Promise<CryptoKey> => {
  const master = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: exactBuffer(HKDF_SALT), info: new ArrayBuffer(0) },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
};

const toArrayBuffer = (source: BufferSource): ArrayBuffer =>
  source instanceof ArrayBuffer
    ? source
    : exactBuffer(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));

const prfResultOf = (credential: Credential | null): ArrayBuffer | undefined => {
  if (!(credential instanceof PublicKeyCredential)) return undefined;
  const first = credential.getClientExtensionResults().prf?.results?.first;
  return first === undefined ? undefined : toArrayBuffer(first);
};

const assertPrf = async (credentialIdB64: string, prfSaltB64: string): Promise<ArrayBuffer | undefined> => {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: exactBuffer(randomBytes(32)),
      allowCredentials: [
        { type: 'public-key', id: exactBuffer(fromBase64(credentialIdB64)) },
      ],
      userVerification: 'required',
      extensions: { prf: { eval: { first: exactBuffer(fromBase64(prfSaltB64)) } } },
    },
  });
  return prfResultOf(assertion);
};

/**
 * Create a platform passkey with PRF and derive its KEK. Returns undefined when
 * the user cancels or the authenticator lacks PRF (AC-1.0b) — callers fall back
 * to password-only.
 */
export const enrollPasskey = async (): Promise<EnrolledPasskey | undefined> => {
  const prfSalt = randomBytes(32);
  const prfSaltB64 = toBase64(prfSalt);
  try {
    const credential = await navigator.credentials.create({
      signal: AbortSignal.timeout(60_000),
      publicKey: {
        challenge: exactBuffer(randomBytes(32)),
        rp: { name: RP_NAME, id: globalThis.location.hostname },
        user: {
          id: exactBuffer(randomBytes(16)),
          name: 'vault',
          displayName: 'Vault key',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        extensions: { prf: { eval: { first: exactBuffer(prfSalt) } } },
      },
    });
    if (!(credential instanceof PublicKeyCredential)) return undefined;
    const extensions = credential.getClientExtensionResults();
    const credentialIdB64 = toBase64(new Uint8Array(credential.rawId));
    const fromCreate = prfResultOf(credential);
    const prfOutput =
      fromCreate ?? (extensions.prf?.enabled === true ? await assertPrf(credentialIdB64, prfSaltB64) : undefined);
    if (prfOutput === undefined) return undefined;
    return { credentialIdB64, prfSaltB64, kek: await kekFromPrfOutput(prfOutput) };
  } catch {
    return undefined;
  }
};

/** Run the unlock ceremony for a stored protector; undefined on cancel/failure. */
export const passkeyKek = async (
  protector: Pick<PasskeyProtectorRecord, 'credentialIdB64' | 'prfSaltB64'>,
): Promise<CryptoKey | undefined> => {
  try {
    const prfOutput = await assertPrf(protector.credentialIdB64, protector.prfSaltB64);
    return prfOutput === undefined ? undefined : await kekFromPrfOutput(prfOutput);
  } catch {
    return undefined;
  }
};
