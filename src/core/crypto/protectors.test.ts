import { describe, expect, test } from 'bun:test';
import { toBase64, utf8Decode, utf8Encode } from './bytes';
import { openRecord, sealRecord } from './envelope';
import { deriveKek, generateWrappableDek, unwrapDek, wrapDek, type KdfParams } from './keys';
import { kekFromPrfOutput } from './passkey';

const fastKdf = (): KdfParams => ({
  algo: 'argon2id',
  saltB64: toBase64(crypto.getRandomValues(new Uint8Array(16))),
  memoryKiB: 256,
  iterations: 1,
  parallelism: 1,
});

const fakePrfOutput = (): ArrayBuffer => crypto.getRandomValues(new Uint8Array(32)).buffer;

describe('protector model: passkey KEK + password KEK wrap one DEK (AC-1.0)', () => {
  test('both protectors unwrap the same DEK and decrypt the same data', async () => {
    const prfOutput = fakePrfOutput();
    const passwordKek = await deriveKek('fallback password', fastKdf());
    const passkeyKek = await kekFromPrfOutput(prfOutput);

    const wrappable = await generateWrappableDek();
    const wrappedForPassword = await wrapDek(passwordKek, wrappable);
    const wrappedForPasskey = await wrapDek(passkeyKek, wrappable);

    const sealed = await sealRecord(await unwrapDek(passwordKek, wrappedForPassword), 'r', utf8Encode('shared'));

    const viaPasskey = await unwrapDek(await kekFromPrfOutput(prfOutput), wrappedForPasskey);
    expect(viaPasskey.extractable).toBe(false);
    expect(utf8Decode(await openRecord(viaPasskey, 'r', sealed))).toBe('shared');
  });

  test('a different PRF output fails uniformly (AC-1.3)', async () => {
    const passkeyKek = await kekFromPrfOutput(fakePrfOutput());
    const wrappable = await generateWrappableDek();
    const wrapped = await wrapDek(passkeyKek, wrappable);
    const wrongKek = await kekFromPrfOutput(fakePrfOutput());
    expect(unwrapDek(wrongKek, wrapped)).rejects.toBeDefined();
  });

  test('late enrollment: transient extractable unwrap re-wraps under a new KEK (AC-1.0c)', async () => {
    const passwordKek = await deriveKek('the password', fastKdf());
    const original = await generateWrappableDek();
    const wrappedForPassword = await wrapDek(passwordKek, original);
    const sealed = await sealRecord(await unwrapDek(passwordKek, wrappedForPassword), 'r', utf8Encode('old data'));

    const transient = await unwrapDek(passwordKek, wrappedForPassword, true);
    const newKek = await kekFromPrfOutput(fakePrfOutput());
    const wrappedForPasskey = await wrapDek(newKek, transient);

    const viaNewProtector = await unwrapDek(newKek, wrappedForPasskey);
    expect(utf8Decode(await openRecord(viaNewProtector, 'r', sealed))).toBe('old data');
  });
});
