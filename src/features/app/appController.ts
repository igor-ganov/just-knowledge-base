import { Effect } from 'effect';
import type { NoteId } from '@core/crdt/noteDoc';
import { httpRemote } from '@core/git/remote';
import { syncVault } from '@core/git/sync';
import type { StoragePort } from '@core/storage/ports';
import { readManifest } from '@core/storage/vaultStore';
import { buildIndex, emptyIndex, type KnowledgeIndex } from '@features/search/indexes';
import { readSyncSettings, writeSyncSettings, type SyncSettings } from '@features/sync/syncConfig';
import {
  activeNotes,
  createNote,
  createVault,
  deleteNote,
  flushVault,
  loadFromDisk,
  onVaultChange,
  unlockVault,
  type VaultHandle,
} from '@features/vault/vaultService';
import { createStore } from './store';
import { createWebStorage } from './webStorage';

/**
 * Application controller: the single stateful seam between the pure domain /
 * services and the Lit components. Components read stores and call actions.
 */
export type Phase = 'boot' | 'no-vault' | 'locked' | 'unlocked';
export type SyncStatus =
  | { readonly state: 'idle' | 'syncing' | 'ok' }
  | { readonly state: 'error'; readonly message: string };

const AUTOSAVE_MS = 700;
const INDEX_REBUILD_MS = 120;
const AUTO_LOCK_MS_DEFAULT = 15 * 60 * 1000;
const AUTO_LOCK_KEY = 'jkb-autolock-minutes';

export const phaseStore = createStore<Phase>('boot');
export const indexStore = createStore<KnowledgeIndex>(emptyIndex());
export const selectedNoteStore = createStore<NoteId | undefined>(undefined);
export const tagFilterStore = createStore<string | undefined>(undefined);
export const queryStore = createStore<string>('');
export const syncStatusStore = createStore<SyncStatus>({ state: 'idle' });
export const syncSettingsStore = createStore<SyncSettings | undefined>(undefined);
export const unlockErrorStore = createStore<string | undefined>(undefined);
export type SaveState = 'saved' | 'dirty' | 'saving';
export const saveStateStore = createStore<SaveState>('saved');

let storage: StoragePort | undefined;
let handle: VaultHandle | undefined;
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let indexTimer: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribeVault: (() => void) | undefined;

export const vaultHandle = (): VaultHandle | undefined => handle;

export const autoLockMs = (): number => {
  const minutes = Number(globalThis.localStorage?.getItem(AUTO_LOCK_KEY) ?? '');
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : AUTO_LOCK_MS_DEFAULT;
};

export const setAutoLockMinutes = (minutes: number): void => {
  globalThis.localStorage?.setItem(AUTO_LOCK_KEY, String(minutes));
  resetIdleTimer();
};

const rebuildIndex = (): void => {
  indexStore.set(handle === undefined ? emptyIndex() : buildIndex(activeNotes(handle)));
};

const scheduleIndexRebuild = (): void => {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(rebuildIndex, INDEX_REBUILD_MS);
};

const scheduleAutosave = (): void => {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void flushCurrent('vault: autosave');
  }, AUTOSAVE_MS);
};

const hasPendingWrites = (): boolean =>
  handle !== undefined &&
  ([...handle.dirtyNotes.values()].some((updates) => updates.length > 0) ||
    handle.dirtyCatalog.length > 0);

const flushCurrent = async (message: string): Promise<void> => {
  if (handle === undefined) return;
  saveStateStore.set('saving');
  await flushVault(handle, message).catch(() => undefined);
  saveStateStore.set(hasPendingWrites() ? 'dirty' : 'saved');
};

/** AC-9.1: auto-lock after inactivity. Any pointer/key activity resets it. */
export const resetIdleTimer = (): void => {
  clearTimeout(idleTimer);
  if (phaseStore.get() !== 'unlocked') return;
  idleTimer = setTimeout(() => {
    void lock();
  }, autoLockMs());
};

const postUnlock = async (unlocked: VaultHandle): Promise<void> => {
  handle = unlocked;
  unsubscribeVault = onVaultChange(unlocked, () => {
    saveStateStore.set('dirty');
    scheduleIndexRebuild();
    scheduleAutosave();
  });
  rebuildIndex();
  syncSettingsStore.set(await readSyncSettings(unlocked));
  unlockErrorStore.set(undefined);
  phaseStore.set('unlocked');
  resetIdleTimer();
};

export const boot = async (): Promise<void> => {
  storage = createWebStorage();
  const manifest = await readManifest(storage).catch(() => undefined);
  phaseStore.set(manifest === undefined ? 'no-vault' : 'locked');
};

export const createNewVault = async (password: string): Promise<void> => {
  if (storage === undefined) return;
  await postUnlock(await createVault(storage, password));
};

export const unlock = async (password: string): Promise<void> => {
  if (storage === undefined) return;
  const result = await unlockVault(storage, password);
  switch (result.kind) {
    case 'ok':
      return postUnlock(result.handle);
    case 'wrong-password':
      unlockErrorStore.set('Wrong password. The vault stays locked.');
      return;
    case 'no-vault':
      phaseStore.set('no-vault');
      return;
  }
};

/** AC-9.2: drop the DEK and every decrypted structure; return to lock screen. */
export const lock = async (): Promise<void> => {
  await flushCurrent('vault: lock');
  unsubscribeVault?.();
  clearTimeout(autosaveTimer);
  clearTimeout(indexTimer);
  clearTimeout(idleTimer);
  handle = undefined;
  indexStore.set(emptyIndex());
  selectedNoteStore.set(undefined);
  tagFilterStore.set(undefined);
  queryStore.set('');
  syncSettingsStore.set(undefined);
  syncStatusStore.set({ state: 'idle' });
  phaseStore.set('locked');
};

export const addNote = (title: string): NoteId | undefined => {
  if (handle === undefined) return undefined;
  const id = createNote(handle, title);
  selectedNoteStore.set(id);
  return id;
};

export const removeNote = (id: NoteId): void => {
  if (handle === undefined) return;
  deleteNote(handle, id);
  selectedNoteStore.update((selected) => (selected === id ? undefined : selected));
};

export const saveSyncSettings = async (settings: SyncSettings): Promise<void> => {
  if (handle === undefined) return;
  await writeSyncSettings(handle, settings);
  syncSettingsStore.set(settings);
  scheduleAutosave();
};

export const syncNow = async (): Promise<void> => {
  const settings = syncSettingsStore.get();
  if (handle === undefined || settings === undefined || settings.url === '') return;
  const current = handle;
  syncStatusStore.set({ state: 'syncing' });
  try {
    await flushVault(current, 'vault: pre-sync');
    await Effect.runPromise(syncVault(current.storage, httpRemote(settings)));
    await loadFromDisk(current);
    rebuildIndex();
    syncStatusStore.set({ state: 'ok' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync failed';
    syncStatusStore.set({ state: 'error', message });
  }
};
