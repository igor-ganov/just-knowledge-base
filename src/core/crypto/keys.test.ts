import { describe, expect, test } from 'bun:test';
import { toBase64, utf8Decode, utf8Encode } from './bytes';
import { openRecord, sealRecord } from './envelope';
import { createDek, deriveKek, unwrapDek, type KdfParams } from './keys';

/** Tiny parameters: tests exercise correctness, not KDF hardness. */
const testKdfParams = (): KdfParams => ({
  algo: 'argon2id',
  saltB64: toBase64(crypto.getRandomValues(new Uint8Array(16))),
  memoryKiB: 256,
  iterations: 1,
  parallelism: 1,
});

describe('key hierarchy (AC-1.1..1.4)', () => {
  test('create → wrap → unwrap roundtrip yields a working non-extractable DEK', async () => {
    const params = testKdfParams();
    const kek = await deriveKek('correct horse', params);
    const { dek, wrappedDekB64 } = await createDek(kek);
    expect(dek.extractable).toBe(false);

    const sealed = await sealRecord(dek, 'r', utf8Encode('vault data'));

    const kekAgain = await deriveKek('correct horse', params);
    const dekAgain = await unwrapDek(kekAgain, wrappedDekB64);
    expect(dekAgain.extractable).toBe(false);
    expect(utf8Decode(await openRecord(dekAgain, 'r', sealed))).toBe('vault data');
  });

  test('wrong password fails at DEK unwrap, uniformly (AC-1.3)', async () => {
    const params = testKdfParams();
    const kek = await deriveKek('right password', params);
    const { wrappedDekB64 } = await createDek(kek);

    const wrongKek = await deriveKek('wrong password', params);
    expect(unwrapDek(wrongKek, wrappedDekB64)).rejects.toBeDefined();
  });
});
