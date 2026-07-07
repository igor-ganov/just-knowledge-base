import * as Y from 'yjs';
import { isNoteDeleted, catalogMap, knownNoteIds, recordDelete, registerNote } from '@core/crdt/catalog';
import {
  createNoteDoc,
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
} from '@core/storage/vaultStore';

/**
 * Vault lifecycle and note persistence (US-1, US-2). Platform-agnostic: works
 * against any StoragePort, so the same code runs in browser tests (node fs)
 * and the web app (LightningFS) — NFR-4.
 */
const DISK_ORIGIN = 'disk';

export type VaultHandle = {
  readonly storage: StoragePort;
  readonly dek: CryptoKey;
  readonly catalog: Y.Doc;
  readonly notes: Map<NoteId, Y.Doc>;
  readonly dirtyNotes: Map<NoteId, Uint8Array[]>;
  readonly dirtyCatalog: Uint8Array[];
  readonly warnings: CorruptBlob[];
  /** Fired on ANY content change (local edits and disk/sync loads) — UI refresh hook. */
  readonly listeners: Set<() => void>;
};

const notifyChange = (handle: VaultHandle): void => handle.listeners.forEach((listener) => listener());

export const onVaultChange = (handle: VaultHandle, listener: () => void): (() => void) => {
  handle.listeners.add(listener);
  return () => handle.listeners.delete(listener);
};

export type UnlockResult =
  | { readonly kind: 'ok'; readonly handle: VaultHandle }
  | { readonly kind: 'wrong-password' }
  | { readonly kind: 'no-vault' };

const trackNoteDoc = (handle: VaultHandle, id: NoteId, doc: Y.Doc): void => {
  handle.notes.set(id, doc);
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== DISK_ORIGIN) {
      const pending = handle.dirtyNotes.get(id) ?? [];
      pending.push(update);
      handle.dirtyNotes.set(id, pending);
    }
    notifyChange(handle);
  });
};

const emptyHandle = (storage: StoragePort, dek: CryptoKey): VaultHandle => {
  const handle: VaultHandle = {
    storage,
    dek,
    catalog: new Y.Doc(),
    notes: new Map(),
    dirtyNotes: new Map(),
    dirtyCatalog: [],
    warnings: [],
    listeners: new Set(),
  };
  handle.catalog.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== DISK_ORIGIN) handle.dirtyCatalog.push(update);
    notifyChange(handle);
  });
  return handle;
};

export const createVault = async (
  storage: StoragePort,
  password: string,
  kdfParams: KdfParams = defaultKdfParams(),
  passkey?: EnrolledPasskey,
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
  return emptyHandle(storage, dek);
};

/** Unlock via the passkey protector (AC-1.0/1.0a). */
export const unlockVaultWithPasskey = async (
  storage: StoragePort,
): Promise<UnlockResult | { readonly kind: 'passkey-failed' }> => {
  const manifest = await readManifest(storage);
  if (manifest === undefined) return { kind: 'no-vault' };
  if (manifest.passkey === undefined) return { kind: 'passkey-failed' };
  const kek = await passkeyKek(manifest.passkey);
  if (kek === undefined) return { kind: 'passkey-failed' };
  try {
    const dek = await unwrapDek(kek, manifest.passkey.wrappedDekB64);
    const handle = emptyHandle(storage, dek);
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

/** Idempotently fold every on-disk blob into the live docs (post-unlock, post-sync). */
export const loadFromDisk = async (handle: VaultHandle): Promise<void> => {
  const catalogRead = await readCatalogBlobs(handle.storage, handle.dek);
  handle.warnings.push(...catalogRead.corrupt);
  for (const blob of catalogRead.blobs) Y.applyUpdate(handle.catalog, blob, DISK_ORIGIN);
  for (const id of knownNoteIds(handle.catalog)) {
    const doc = handle.notes.get(id) ?? createNoteDoc();
    if (!handle.notes.has(id)) trackNoteDoc(handle, id, doc);
    const noteRead = await readNoteBlobs(handle.storage, handle.dek, id);
    handle.warnings.push(...noteRead.corrupt);
    for (const blob of noteRead.blobs) Y.applyUpdate(doc, blob, DISK_ORIGIN);
  }
};

export const unlockVault = async (storage: StoragePort, password: string): Promise<UnlockResult> => {
  const manifest = await readManifest(storage);
  if (manifest === undefined) return { kind: 'no-vault' };
  const kek = await deriveKek(password, manifest.kdf);
  try {
    const dek = await unwrapDek(kek, manifest.wrappedDekB64);
    const handle = emptyHandle(storage, dek);
    await loadFromDisk(handle);
    return { kind: 'ok', handle };
  } catch {
    return { kind: 'wrong-password' };
  }
};

export const createNote = (handle: VaultHandle, title: string): NoteId => {
  const id = newNoteId();
  const doc = createNoteDoc();
  trackNoteDoc(handle, id, doc);
  setNoteTitle(doc, title);
  registerNote(handle.catalog, id);
  return id;
};

export const deleteNote = (handle: VaultHandle, id: NoteId): void => {
  const doc = handle.notes.get(id);
  if (doc === undefined) return;
  recordDelete(handle.catalog, id, doc);
};

export const isActive = (handle: VaultHandle, id: NoteId): boolean => {
  const doc = handle.notes.get(id);
  return doc !== undefined && !isNoteDeleted(catalogMap(handle.catalog).get(id), doc);
};

export const activeNotes = (handle: VaultHandle): ReadonlyArray<NoteSnapshot> =>
  knownNoteIds(handle.catalog)
    .filter((id) => isActive(handle, id))
    .map((id) => {
      const doc = handle.notes.get(id);
      return doc === undefined ? undefined : snapshotNote(id, doc);
    })
    .filter((snapshot): snapshot is NoteSnapshot => snapshot !== undefined);

/** Persist pending CRDT updates as encrypted append-only blobs and commit (AC-2.2). */
export const flushVault = async (handle: VaultHandle, message: string): Promise<boolean> => {
  const dirtyNoteIds = [...handle.dirtyNotes.entries()].filter(([, updates]) => updates.length > 0);
  const catalogDirty = handle.dirtyCatalog.length > 0;
  if (dirtyNoteIds.length === 0 && !catalogDirty) return false;
  for (const [id, updates] of dirtyNoteIds) {
    await writeNoteBlob(handle.storage, handle.dek, id, mergeUpdateBlobs(updates));
    handle.dirtyNotes.set(id, []);
  }
  if (catalogDirty) {
    await writeCatalogBlob(handle.storage, handle.dek, mergeUpdateBlobs(handle.dirtyCatalog));
    handle.dirtyCatalog.length = 0;
  }
  await commitAll(handle.storage, message);
  await persistStorage(handle.storage);
  return true;
};
