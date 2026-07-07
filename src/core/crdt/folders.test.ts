import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  createFolder,
  deleteFolder,
  folderTree,
  listFolders,
  moveNote,
  renameFolder,
} from './folders';
import { encodeFullState, loadDocFromBlobs, type NoteSnapshot } from './noteDoc';

const note = (id: string, title: string): NoteSnapshot => ({ id, title, body: '' });

describe('folders (AC-F1.1..1.5)', () => {
  test('create, nest, place notes, tree projection', () => {
    const catalog = new Y.Doc();
    const work = createFolder(catalog, 'Work');
    const inbox = createFolder(catalog, 'Inbox', work);
    moveNote(catalog, 'n1', inbox);
    moveNote(catalog, 'n2', '');

    const tree = folderTree(catalog, [note('n1', 'In inbox'), note('n2', 'At root')]);
    expect(tree.notes.map((entry) => entry.title)).toEqual(['At root']);
    expect(tree.folders).toHaveLength(1);
    expect(tree.folders[0]?.name).toBe('Work');
    expect(tree.folders[0]?.folders[0]?.name).toBe('Inbox');
    expect(tree.folders[0]?.folders[0]?.notes[0]?.title).toBe('In inbox');
  });

  test('empty folders exist; rename works (AC-F1.1)', () => {
    const catalog = new Y.Doc();
    const id = createFolder(catalog, 'Empty');
    renameFolder(catalog, id, 'Renamed');
    expect(listFolders(catalog)).toEqual([{ id, name: 'Renamed' }]);
    expect(folderTree(catalog, []).folders[0]?.name).toBe('Renamed');
  });

  test('deleting a folder re-roots its notes and children (AC-F1.4)', () => {
    const catalog = new Y.Doc();
    const parent = createFolder(catalog, 'Parent');
    const child = createFolder(catalog, 'Child', parent);
    moveNote(catalog, 'n1', parent);
    deleteFolder(catalog, parent);

    const tree = folderTree(catalog, [note('n1', 'Orphan')]);
    expect(tree.notes.map((entry) => entry.title)).toEqual(['Orphan']);
    expect(tree.folders.map((entry) => entry.id)).toEqual([child]);
  });

  test('concurrent folder creation on two devices converges (AC-F1.5)', () => {
    const deviceA = new Y.Doc();
    const deviceB = loadDocFromBlobs([encodeFullState(deviceA)]);
    createFolder(deviceA, 'From A');
    createFolder(deviceB, 'From B');

    const merged = loadDocFromBlobs([encodeFullState(deviceA), encodeFullState(deviceB)]);
    expect(listFolders(merged).map((folder) => folder.name).toSorted()).toEqual(['From A', 'From B']);
  });
});
