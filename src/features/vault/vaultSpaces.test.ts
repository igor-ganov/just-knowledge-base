import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noteBody } from '@core/crdt/noteDoc';
import { toBase64, utf8Decode } from '@core/crypto/bytes';
import type { KdfParams } from '@core/crypto/keys';
import type { StoragePort } from '@core/storage/ports';
import {
  activeNotes,
  createNote,
  createVault,
  flushVault,
  moveNoteToSpace,
  spaceOfNote,
  unlockVault,
} from './vaultService';

const tempStorage = (): StoragePort => ({
  fs: { promises: nodeFs.promises },
  dir: mkdtempSync(join(tmpdir(), 'jkb-sp-')).replaceAll('\\', '/'),
});

const fastKdf = (): KdfParams => ({
  algo: 'argon2id',
  saltB64: toBase64(crypto.getRandomValues(new Uint8Array(16))),
  memoryKiB: 256,
  iterations: 1,
  parallelism: 1,
});

describe('public/private spaces (spec spaces)', () => {
  test('AC-S1: public blobs are plaintext on disk, private blobs are not', async () => {
    const storage = tempStorage();
    const handle = await createVault(storage, 'pw', fastKdf(), undefined, 'igor-ganov');
    const privateId = createNote(handle, 'Secret note', 'private');
    noteBody(handle.spaces.private.notes.get(privateId) ?? handle.catalog).insert(0, 'top secret content');
    const publicId = createNote(handle, 'Team note', 'public');
    noteBody(handle.spaces.public.notes.get(publicId) ?? handle.catalog).insert(0, 'shared team content');
    await flushVault(handle, 'save');

    const publicDir = join(storage.dir, 'public', 'notes', publicId);
    const publicBlob = nodeFs.readFileSync(join(publicDir, readdirSync(publicDir)[0] ?? ''));
    expect(utf8Decode(publicBlob)).toContain('shared team content');

    const privateDir = join(storage.dir, 'private', 'igor-ganov', 'notes', privateId);
    const privateBlob = nodeFs.readFileSync(join(privateDir, readdirSync(privateDir)[0] ?? ''));
    expect(utf8Decode(privateBlob)).not.toContain('top secret content');
  });

  test('AC-S2 + AC-S4: notes reload into their spaces; move re-homes the content', async () => {
    const storage = tempStorage();
    const handle = await createVault(storage, 'pw', fastKdf(), undefined, 'igor-ganov');
    const id = createNote(handle, 'Wanderer', 'private');
    noteBody(handle.spaces.private.notes.get(id) ?? handle.catalog).insert(0, 'travels between spaces');
    await flushVault(handle, 'save');

    moveNoteToSpace(handle, id, 'public');
    expect(spaceOfNote(handle, id)).toBe('public');
    await flushVault(handle, 'move');

    const unlocked = await unlockVault(storage, 'pw', 'igor-ganov');
    expect(unlocked.kind).toBe('ok');
    if (unlocked.kind !== 'ok') return;
    const notes = activeNotes(unlocked.handle);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.space).toBe('public');
    expect(notes[0]?.body).toBe('travels between spaces');
  });

  test('AC-S6: legacy root-layout private notes stay readable', async () => {
    const storage = tempStorage();
    const legacy = await createVault(storage, 'pw', fastKdf(), undefined, 'local');
    // Simulate a v1 vault: force the legacy prefix by writing through fallback paths.
    const id = createNote(legacy, 'Old note', 'private');
    noteBody(legacy.spaces.private.notes.get(id) ?? legacy.catalog).insert(0, 'from the old layout');
    await flushVault(legacy, 'save');

    // A later session with a connected identity uses a new prefix but must read the old data.
    const unlocked = await unlockVault(storage, 'pw', 'igor-ganov');
    expect(unlocked.kind).toBe('ok');
    if (unlocked.kind !== 'ok') return;
    expect(activeNotes(unlocked.handle).map((note) => note.title)).toEqual(['Old note']);
  });
});
