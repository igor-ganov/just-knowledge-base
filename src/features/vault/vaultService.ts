import * as Y from 'yjs';
import { isNoteDeleted, catalogMap, knownNoteIds, recordDelete, registerNote } from '@core/crdt/catalog';
import {
  createNoteDoc,
  encodeFullState,
  mergeUpdateBlobs,
  newNoteId,
  setNoteTitle,
  snapshotNote,
  type NoteId,
  type NoteSnapshot,
} from '@core/crdt/noteDoc';
import {
  defaultKdfParams,
  deriveKek,
  generateWrappableDek,
  unwrapDek,
  wrapDek,
  type KdfParams,
  type VaultManifest,
} from '@core/crypto/keys';
import { passkeyKek, type EnrolledPasskey } from '@core/crypto/passkey';
import { commitAll, initRepo } from '@core/git/repo';
import { persistStorage, type StoragePort } from '@core/storage/ports';
import {
  readCatalogBlobs,
  readManifest,
  readNoteBlobs,
  writeCatalogBlob,
  writeManifest,
  writeNoteBlob,
  type CorruptBlob,
  type SpacePaths,
} from '@core/storage/vaultStore';

/**
 * Vault lifecycle and note persistence (US-1, US-2, spec spaces). The vault
 * holds two spaces: `private` (AEAD-encrypted with the user's DEK, per-user
 * prefix) and `public` (plaintext CRDT blobs shared by every repo user).
 * Platform-agnostic behind StoragePort (NFR-4).
 */
const DISK_ORIGIN = 'disk';

export type SpaceName = 'private' | 'public';
export const SPACES: ReadonlyArray<SpaceName> = ['private', 'public'];

export type SpaceState = {
  readonly catalog: Y.Doc;
  readonly notes: Map<NoteId, Y.Doc>;
  readonly dirtyNotes: Map<NoteId, Uint8Array[]>;
  readonly dirtyCatalog: Uint8Array[];
};

export type VaultHandle = {
  readonly storage: StoragePort;
  readonly dek: CryptoKey;
  readonly spaces: Readonly<Record<SpaceName, SpaceState>>;
  /** Back-compat aliases for the private space (most call sites). */
  readonly catalog: Y.Doc;
  readonly notes: Map<NoteId, Y.Doc>;
  readonly dirtyNotes: Map<NoteId, Uint8Array[]>;
  readonly dirtyCatalog: Uint8Array[];
  readonly warnings: CorruptBlob[];
  readonly listeners: Set<() => void>;
  readonly paths: Readonly<Record<SpaceName, SpacePaths>>;
};

export type UnlockResult =
  | { readonly kind: 'ok'; readonly handle: VaultHandle }
  | { readonly kind: 'wrong-password' }
  | { readonly kind: 'no-vault' };

const sanitizeUser = (user: string): string => user.toLowerCase().replaceAll(/[^a-z0-9_-]/gu, '-');

export const spacePathsFor = (user: string): Readonly<Record<SpaceName, SpacePaths>> => {
  const prefix = `private/${sanitizeUser(user)}`;
  // Fallbacks: the v1 root layout, plus the pre-identity local prefix so data
  // created before connecting GitHub stays visible (AC-S6).
  const fallbacks = prefix === 'private/local' ? [''] : ['', 'private/local'];
  return {
    private: { prefix, readFallbacks: fallbacks },
    public: { prefix: 'public', readFallbacks: [] },
  };
};

const notifyChange = (handle: VaultHandle): void => handle.listeners.forEach((listener) => listener());

export const onVaultChange = (handle: VaultHandle, listener: () => void): (() => void) => {
  handle.listeners.add(listener);
  return () => handle.listeners.delete(listener);
};

const spaceDekOf = (handle: VaultHandle, space: SpaceName): CryptoKey | undefined =>
  space === 'private' ? handle.dek : undefined;

const trackNoteDoc = (handle: VaultHandle, space: SpaceName, id: NoteId, doc: Y.Doc): void => {
  const state = handle.spaces[space];
  state.notes.set(id, doc);
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== DISK_ORIGIN && state.notes.get(id) === doc) {
      const pending = state.dirtyNotes.get(id) ?? [];
      pending.push(update);
      state.dirtyNotes.set(id, pending);
    }
    notifyChange(handle);
  });
};

const emptySpace = (handle: () => VaultHandle): SpaceState => {
  const state: SpaceState = {
    catalog: new Y.Doc(),
    notes: new Map(),
    dirtyNotes: new Map(),
    dirtyCatalog: [],
  };
  state.catalog.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== DISK_ORIGIN) state.dirtyCatalog.push(update);
    notifyChange(handle());
  });
  return state;
};

const emptyHandle = (storage: StoragePort, dek: CryptoKey, user: string): VaultHandle => {
  // eslint-disable-next-line prefer-const
  let handle: VaultHandle;
  const privateSpace = emptySpace(() => handle);
  const publicSpace = emptySpace(() => handle);
  handle = {
    storage,
    dek,
    spaces: { private: privateSpace, public: publicSpace },
    catalog: privateSpace.catalog,
    notes: privateSpace.notes,
    dirtyNotes: privateSpace.dirtyNotes,
    dirtyCatalog: privateSpace.dirtyCatalog,
    warnings: [],
    listeners: new Set(),
    paths: spacePathsFor(user),
  };
  return handle;
};

export const createVault = async (
  storage: StoragePort,
  password: string,
  kdfParams: KdfParams = defaultKdfParams(),
  passkey?: EnrolledPasskey,
  user = 'local',
): Promise<VaultHandle> => {
  await initRepo(storage);
  const kek = await deriveKek(password, kdfParams);
  const wrappable = await generateWrappableDek();
  const wrappedDekB64 = await wrapDek(kek, wrappable);
  const manifest: VaultManifest = {
    formatVersion: 1,
    kdf: kdfParams,
    wrappedDekB64,
    createdAt: new Date().toISOString(),
    ...(passkey === undefined
      ? {}
      : {
          passkey: {
            credentialIdB64: passkey.credentialIdB64,
            prfSaltB64: passkey.prfSaltB64,
            wrappedDekB64: await wrapDek(passkey.kek, wrappable),
          },
        }),
  };
  await writeManifest(storage, manifest);
  await commitAll(storage, 'vault: create');
  await persistStorage(storage);
  const dek = await unwrapDek(kek, wrappedDekB64);
  return emptyHandle(storage, dek, user);
};

/** Idempotently fold every on-disk blob into the live docs (post-unlock, post-sync). */
export const loadFromDisk = async (handle: VaultHandle): Promise<void> => {
  for (const space of SPACES) {
    const state = handle.spaces[space];
    const dek = spaceDekOf(handle, space);
    const catalogRead = await readCatalogBlobs(handle.storage, dek, handle.paths[space]);
    handle.warnings.push(...catalogRead.corrupt);
    for (const blob of catalogRead.blobs) Y.applyUpdate(state.catalog, blob, DISK_ORIGIN);
    for (const id of knownNoteIds(state.catalog)) {
      const doc = state.notes.get(id) ?? createNoteDoc();
      if (!state.notes.has(id)) trackNoteDoc(handle, space, id, doc);
      const noteRead = await readNoteBlobs(handle.storage, dek, handle.paths[space], id);
      handle.warnings.push(...noteRead.corrupt);
      for (const blob of noteRead.blobs) Y.applyUpdate(doc, blob, DISK_ORIGIN);
    }
  }
};

export const unlockVault = async (
  storage: StoragePort,
  password: string,
  user = 'local',
): Promise<UnlockResult> => {
  const manifest = await readManifest(storage);
  if (manifest === undefined) return { kind: 'no-vault' };
  const kek = await deriveKek(password, manifest.kdf);
  try {
    const dek = await unwrapDek(kek, manifest.wrappedDekB64);
    const handle = emptyHandle(storage, dek, user);
    await loadFromDisk(handle);
    return { kind: 'ok', handle };
  } catch {
    return { kind: 'wrong-password' };
  }
};

/** Unlock via the passkey protector (AC-1.0/1.0a). */
export const unlockVaultWithPasskey = async (
  storage: StoragePort,
  user = 'local',
): Promise<UnlockResult | { readonly kind: 'passkey-failed' }> => {
  const manifest = await readManifest(storage);
  if (manifest === undefined) return { kind: 'no-vault' };
  if (manifest.passkey === undefined) return { kind: 'passkey-failed' };
  const kek = await passkeyKek(manifest.passkey);
  if (kek === undefined) return { kind: 'passkey-failed' };
  try {
    const dek = await unwrapDek(kek, manifest.passkey.wrappedDekB64);
    const handle = emptyHandle(storage, dek, user);
    await loadFromDisk(handle);
    return { kind: 'ok', handle };
  } catch {
    return { kind: 'passkey-failed' };
  }
};

/**
 * Enroll a passkey on an existing vault (AC-1.0c): the password unwraps a
 * transient extractable DEK handle, which is immediately re-wrapped under the
 * passkey KEK. Raw key bytes never surface to JS.
 */
export const addPasskeyProtector = async (
  storage: StoragePort,
  password: string,
  passkey: EnrolledPasskey,
): Promise<'ok' | 'wrong-password' | 'no-vault'> => {
  const manifest = await readManifest(storage);
  if (manifest === undefined) return 'no-vault';
  const kek = await deriveKek(password, manifest.kdf);
  try {
    const wrappable = await unwrapDek(kek, manifest.wrappedDekB64, true);
    const updated: VaultManifest = {
      ...manifest,
      passkey: {
        credentialIdB64: passkey.credentialIdB64,
        prfSaltB64: passkey.prfSaltB64,
        wrappedDekB64: await wrapDek(passkey.kek, wrappable),
      },
    };
    await writeManifest(storage, updated);
    await commitAll(storage, 'vault: add passkey protector');
    await persistStorage(storage);
    return 'ok';
  } catch {
    return 'wrong-password';
  }
};

const activeIn = (handle: VaultHandle, space: SpaceName, id: NoteId): boolean => {
  const state = handle.spaces[space];
  const doc = state.notes.get(id);
  return doc !== undefined && !isNoteDeleted(catalogMap(state.catalog).get(id), doc);
};

/** A note's home is the space where it is ACTIVE (a move tombstones the source). */
export const spaceOfNote = (handle: VaultHandle, id: NoteId): SpaceName => {
  switch (true) {
    case activeIn(handle, 'private', id):
      return 'private';
    case activeIn(handle, 'public', id):
      return 'public';
    default:
      return handle.spaces.public.notes.has(id) && !handle.spaces.private.notes.has(id)
        ? 'public'
        : 'private';
  }
};

export const createNote = (handle: VaultHandle, title: string, space: SpaceName = 'private'): NoteId => {
  const id = newNoteId();
  const doc = createNoteDoc();
  trackNoteDoc(handle, space, id, doc);
  setNoteTitle(doc, title);
  registerNote(handle.spaces[space].catalog, id);
  return id;
};

export const deleteNote = (handle: VaultHandle, id: NoteId): void => {
  const space = spaceOfNote(handle, id);
  const doc = handle.spaces[space].notes.get(id);
  if (doc === undefined) return;
  recordDelete(handle.spaces[space].catalog, id, doc);
};

export const isActive = (handle: VaultHandle, id: NoteId): boolean => {
  const space = spaceOfNote(handle, id);
  const state = handle.spaces[space];
  const doc = state.notes.get(id);
  return doc !== undefined && !isNoteDeleted(catalogMap(state.catalog).get(id), doc);
};

export const noteDocOf = (handle: VaultHandle, id: NoteId): Y.Doc | undefined =>
  handle.spaces.private.notes.get(id) ?? handle.spaces.public.notes.get(id);

/**
 * AC-S2: moving a note between spaces re-homes its full CRDT state in the
 * target and tombstones it in the source. The id is stable, so wiki-links
 * keep resolving.
 */
export const moveNoteToSpace = (handle: VaultHandle, id: NoteId, target: SpaceName): void => {
  const source = spaceOfNote(handle, id);
  if (source === target) return;
  const sourceState = handle.spaces[source];
  const doc = sourceState.notes.get(id);
  if (doc === undefined) return;
  recordDelete(sourceState.catalog, id, doc);
  sourceState.notes.delete(id);
  sourceState.dirtyNotes.delete(id);

  const moved = createNoteDoc();
  Y.applyUpdate(moved, encodeFullState(doc));
  trackNoteDoc(handle, target, id, moved);
  const targetState = handle.spaces[target];
  const pending = targetState.dirtyNotes.get(id) ?? [];
  pending.push(encodeFullState(moved));
  targetState.dirtyNotes.set(id, pending);
  registerNote(targetState.catalog, id);
};

export const activeNotes = (handle: VaultHandle): ReadonlyArray<NoteSnapshot> =>
  SPACES.flatMap((space) => {
    const state = handle.spaces[space];
    return knownNoteIds(state.catalog)
      .filter((id) => spaceOfNote(handle, id) === space && isActive(handle, id))
      .map((id) => {
        const doc = state.notes.get(id);
        return doc === undefined ? undefined : { ...snapshotNote(id, doc), space };
      })
      .filter((snapshot): snapshot is NoteSnapshot & { space: SpaceName } => snapshot !== undefined);
  });

/** Persist pending CRDT updates as append-only blobs (sealed or plain) and commit. */
export const flushVault = async (handle: VaultHandle, message: string): Promise<boolean> => {
  let wroteAnything = false;
  for (const space of SPACES) {
    const state = handle.spaces[space];
    const dek = spaceDekOf(handle, space);
    const dirtyNoteIds = [...state.dirtyNotes.entries()].filter(([, updates]) => updates.length > 0);
    const catalogDirty = state.dirtyCatalog.length > 0;
    if (dirtyNoteIds.length === 0 && !catalogDirty) continue;
    wroteAnything = true;
    for (const [id, updates] of dirtyNoteIds) {
      await writeNoteBlob(handle.storage, dek, handle.paths[space], id, mergeUpdateBlobs(updates));
      state.dirtyNotes.set(id, []);
    }
    if (catalogDirty) {
      await writeCatalogBlob(handle.storage, dek, handle.paths[space], mergeUpdateBlobs(state.dirtyCatalog));
      state.dirtyCatalog.length = 0;
    }
  }
  if (!wroteAnything) return false;
  await commitAll(handle.storage, message);
  await persistStorage(handle.storage);
  return true;
};
