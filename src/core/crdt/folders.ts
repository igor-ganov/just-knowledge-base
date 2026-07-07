import * as Y from 'yjs';
import type { NoteId, NoteSnapshot } from './noteDoc';

/**
 * Folder tree in the catalog CRDT (spec folders-and-shell §design). Folders
 * are id-keyed LWW records; note placement is a separate LWW map so moves and
 * status changes never race each other. All projections are pure and
 * deterministic, so devices converge on identical trees (AC-F1.5).
 */
export type FolderId = string;

export type FolderRecord = {
  readonly name: string;
  readonly parentId?: FolderId;
  readonly deleted: boolean;
};

export type FolderTree = {
  readonly id: FolderId | '';
  readonly name: string;
  readonly folders: ReadonlyArray<FolderTree>;
  readonly notes: ReadonlyArray<NoteSnapshot>;
};

const FOLDERS_KEY = 'folders';
const PLACEMENT_KEY = 'notePlacement';

export const foldersMap = (catalog: Y.Doc): Y.Map<FolderRecord> => catalog.getMap(FOLDERS_KEY);
export const placementMap = (catalog: Y.Doc): Y.Map<string> => catalog.getMap(PLACEMENT_KEY);

export const createFolder = (catalog: Y.Doc, name: string, parentId?: FolderId): FolderId => {
  const id = crypto.randomUUID();
  catalog.transact(() => {
    foldersMap(catalog).set(id, { name, deleted: false, ...(parentId === undefined ? {} : { parentId }) });
  });
  return id;
};

export const renameFolder = (catalog: Y.Doc, id: FolderId, name: string): void =>
  catalog.transact(() => {
    const existing = foldersMap(catalog).get(id);
    if (existing !== undefined) foldersMap(catalog).set(id, { ...existing, name });
  });

/** AC-F1.4: deleting a folder keeps notes — they fold to the root at read time. */
export const deleteFolder = (catalog: Y.Doc, id: FolderId): void =>
  catalog.transact(() => {
    const existing = foldersMap(catalog).get(id);
    if (existing !== undefined) foldersMap(catalog).set(id, { ...existing, deleted: true });
  });

export const moveNote = (catalog: Y.Doc, noteId: NoteId, folderId: FolderId | ''): void =>
  catalog.transact(() => {
    placementMap(catalog).set(noteId, folderId);
  });

export const noteFolder = (catalog: Y.Doc, noteId: NoteId): FolderId | '' =>
  placementMap(catalog).get(noteId) ?? '';

type LiveFolder = { readonly id: FolderId; readonly record: FolderRecord };

const liveFolders = (catalog: Y.Doc): ReadonlyArray<LiveFolder> => {
  const all: LiveFolder[] = [];
  foldersMap(catalog).forEach((record, id) => {
    if (!record.deleted) all.push({ id, record });
  });
  return all;
};

/** A folder whose ancestor chain hits a deleted/missing folder re-roots. */
const effectiveParent = (folders: ReadonlyMap<FolderId, FolderRecord>, id: FolderId): FolderId | '' => {
  const parent = folders.get(id)?.parentId ?? '';
  return parent !== '' && folders.has(parent) ? parent : '';
};

export const folderTree = (catalog: Y.Doc, notes: ReadonlyArray<NoteSnapshot>): FolderTree => {
  const live = liveFolders(catalog);
  const byId = new Map(live.map((folder) => [folder.id, folder.record]));
  const childFolders = new Map<FolderId | '', LiveFolder[]>();
  for (const folder of live) {
    const parent = effectiveParent(byId, folder.id);
    childFolders.set(parent, [...(childFolders.get(parent) ?? []), folder]);
  }
  const notesByFolder = new Map<FolderId | '', NoteSnapshot[]>();
  for (const note of notes) {
    const placed = placementMap(catalog).get(note.id) ?? '';
    const target = placed !== '' && byId.has(placed) ? placed : '';
    notesByFolder.set(target, [...(notesByFolder.get(target) ?? []), note]);
  }
  const build = (id: FolderId | '', name: string, seen: ReadonlySet<FolderId>): FolderTree => ({
    id,
    name,
    folders: (childFolders.get(id) ?? [])
      .filter((child) => !seen.has(child.id))
      .sort((left, right) => left.record.name.localeCompare(right.record.name))
      .map((child) => build(child.id, child.record.name, new Set([...seen, child.id]))),
    notes: [...(notesByFolder.get(id) ?? [])].sort((left, right) => left.title.localeCompare(right.title)),
  });
  return build('', '', new Set());
};

export const listFolders = (catalog: Y.Doc): ReadonlyArray<{ id: FolderId; name: string }> =>
  liveFolders(catalog)
    .map((folder) => ({ id: folder.id, name: folder.record.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
