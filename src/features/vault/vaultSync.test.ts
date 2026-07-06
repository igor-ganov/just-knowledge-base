import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { noteBody } from '@core/crdt/noteDoc';
import { initRepo, setMainTo } from '@core/git/repo';
import { syncVault } from '@core/git/sync';
import { inProcessRemote } from '@core/git/testRemote';
import type { GitRemote } from '@core/git/remote';
import type { StoragePort } from '@core/storage/ports';
import { toBase64 } from '@core/crypto/bytes';
import type { KdfParams } from '@core/crypto/keys';
import {
  activeNotes,
  createNote,
  createVault,
  deleteNote,
  flushVault,
  isActive,
  loadFromDisk,
  unlockVault,
  type VaultHandle,
} from './vaultService';

const tempStorage = (): StoragePort => ({
  fs: { promises: nodeFs.promises },
  dir: mkdtempSync(join(tmpdir(), 'jkb-')).replaceAll('\\', '/'),
});

const fastKdf = (): KdfParams => ({
  algo: 'argon2id',
  saltB64: toBase64(crypto.getRandomValues(new Uint8Array(16))),
  memoryKiB: 256,
  iterations: 1,
  parallelism: 1,
});

const sync = (handle: VaultHandle, remote: GitRemote): Promise<void> =>
  Effect.runPromise(syncVault(handle.storage, remote)).then(() => loadFromDisk(handle));

const joinVault = async (remote: GitRemote, password: string): Promise<VaultHandle> => {
  const storage = tempStorage();
  await initRepo(storage);
  const remoteHead = await remote.fetch(storage);
  await setMainTo(storage, remoteHead ?? '');
  const unlocked = await unlockVault(storage, password);
  if (unlocked.kind !== 'ok') throw new Error(`join failed: ${unlocked.kind}`);
  return unlocked.handle;
};

describe('vault lifecycle on real fs (US-1, US-2)', () => {
  test('create → write → relock → unlock sees identical data; wrong password fails', async () => {
    const storage = tempStorage();
    const handle = await createVault(storage, 'pass-1', fastKdf());
    const id = createNote(handle, 'First note');
    noteBody(handle.notes.get(id) ?? handle.catalog).insert(0, 'hello vault');
    await flushVault(handle, 'autosave');

    const wrong = await unlockVault(storage, 'wrong');
    expect(wrong.kind).toBe('wrong-password');

    const unlocked = await unlockVault(storage, 'pass-1');
    expect(unlocked.kind).toBe('ok');
    if (unlocked.kind !== 'ok') return;
    const notes = activeNotes(unlocked.handle);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe('First note');
    expect(notes[0]?.body).toBe('hello vault');
  });
});

describe('two-device sync via git (US-7, US-8)', () => {
  const setupPair = async (): Promise<{
    deviceA: VaultHandle;
    deviceB: VaultHandle;
    remote: GitRemote;
  }> => {
    const remoteRepo = tempStorage();
    await initRepo(remoteRepo);
    const remote = inProcessRemote(remoteRepo);
    const deviceA = await createVault(tempStorage(), 'shared-pass', fastKdf());
    await sync(deviceA, remote);
    const deviceB = await joinVault(remote, 'shared-pass');
    return { deviceA, deviceB, remote };
  };

  test('AC-8.1: different notes edited offline on two devices both survive', async () => {
    const { deviceA, deviceB, remote } = await setupPair();
    const idA = createNote(deviceA, 'From A');
    const idB = createNote(deviceB, 'From B');
    await flushVault(deviceA, 'a');
    await flushVault(deviceB, 'b');

    await sync(deviceA, remote);
    await sync(deviceB, remote);
    await sync(deviceA, remote);

    for (const device of [deviceA, deviceB]) {
      const titles = activeNotes(device).map((note) => note.title).toSorted();
      expect(titles).toEqual(['From A', 'From B']);
      expect(isActive(device, idA)).toBe(true);
      expect(isActive(device, idB)).toBe(true);
    }
  });

  test('AC-8.2: concurrent edits of the same note merge without loss', async () => {
    const { deviceA, deviceB, remote } = await setupPair();
    const id = createNote(deviceA, 'Shared');
    noteBody(deviceA.notes.get(id) ?? deviceA.catalog).insert(0, 'base text');
    await flushVault(deviceA, 'base');
    await sync(deviceA, remote);
    await sync(deviceB, remote);

    const docA = deviceA.notes.get(id);
    const docB = deviceB.notes.get(id);
    if (docA === undefined || docB === undefined) throw new Error('note missing');
    noteBody(docA).insert(0, 'A-start ');
    noteBody(docB).insert(noteBody(docB).length, ' B-end');
    await flushVault(deviceA, 'a-edit');
    await flushVault(deviceB, 'b-edit');

    await sync(deviceA, remote);
    await sync(deviceB, remote);
    await sync(deviceA, remote);

    for (const device of [deviceA, deviceB]) {
      const body = activeNotes(device).find((note) => note.id === id)?.body ?? '';
      expect(body).toContain('A-start');
      expect(body).toContain('base text');
      expect(body).toContain('B-end');
    }
  });

  test('AC-8.3: delete on one device, edit on the other — edit wins after sync', async () => {
    const { deviceA, deviceB, remote } = await setupPair();
    const id = createNote(deviceA, 'Contested');
    await flushVault(deviceA, 'create');
    await sync(deviceA, remote);
    await sync(deviceB, remote);

    deleteNote(deviceA, id);
    const docB = deviceB.notes.get(id);
    if (docB === undefined) throw new Error('note missing on B');
    noteBody(docB).insert(0, 'still relevant! ');
    await flushVault(deviceA, 'delete');
    await flushVault(deviceB, 'edit');

    await sync(deviceA, remote);
    await sync(deviceB, remote);
    await sync(deviceA, remote);

    expect(isActive(deviceA, id)).toBe(true);
    expect(isActive(deviceB, id)).toBe(true);
  });

  test('AC-2.4 + AC-8.5: uncontested delete propagates and states converge', async () => {
    const { deviceA, deviceB, remote } = await setupPair();
    const id = createNote(deviceA, 'Doomed');
    await flushVault(deviceA, 'create');
    await sync(deviceA, remote);
    await sync(deviceB, remote);
    expect(isActive(deviceB, id)).toBe(true);

    deleteNote(deviceA, id);
    await flushVault(deviceA, 'delete');
    await sync(deviceA, remote);
    await sync(deviceB, remote);

    expect(isActive(deviceA, id)).toBe(false);
    expect(isActive(deviceB, id)).toBe(false);
  });
});
