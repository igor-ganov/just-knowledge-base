import { describe, expect, test } from 'bun:test';
import * as fc from 'fast-check';
import * as Y from 'yjs';
import { catalogMap, isNoteDeleted, recordDelete, registerNote } from './catalog';
import {
  createNoteDoc,
  encodeFullState,
  loadDocFromBlobs,
  mergeUpdateBlobs,
  noteBody,
  setNoteBody,
  snapshotNote,
} from './noteDoc';

describe('note CRDT convergence (AC-8.2, AC-8.5)', () => {
  test('concurrent non-overlapping edits of the same note both survive', () => {
    const deviceA = createNoteDoc();
    setNoteBody(deviceA, 'shared base text');
    const base = encodeFullState(deviceA);
    const deviceB = loadDocFromBlobs([base]);

    noteBody(deviceA).insert(0, 'A-prefix ');
    noteBody(deviceB).insert(noteBody(deviceB).length, ' B-suffix');

    const merged = loadDocFromBlobs([encodeFullState(deviceA), encodeFullState(deviceB)]);
    const body = snapshotNote('n', merged).body;
    expect(body).toContain('A-prefix');
    expect(body).toContain('B-suffix');
    expect(body).toContain('shared base text');
  });

  test('property: any interleaving of update blobs converges to identical state', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.boolean(), fc.string({ maxLength: 8 })), { minLength: 1, maxLength: 12 }),
        (operations) => {
          const deviceA = createNoteDoc();
          const deviceB = createNoteDoc();
          const blobs: Uint8Array[] = [];
          for (const [onA, text] of operations) {
            const doc = onA ? deviceA : deviceB;
            noteBody(doc).insert(0, text);
            blobs.push(encodeFullState(doc));
          }
          const shuffled = [...blobs].reverse();
          const one = snapshotNote('n', loadDocFromBlobs(blobs)).body;
          const other = snapshotNote('n', loadDocFromBlobs(shuffled)).body;
          const compacted = snapshotNote('n', loadDocFromBlobs([mergeUpdateBlobs(blobs)])).body;
          expect(other).toBe(one);
          expect(compacted).toBe(one);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('catalog: edit wins over delete (AC-8.3)', () => {
  test('plain delete stays deleted', () => {
    const catalog = new Y.Doc();
    const note = createNoteDoc();
    setNoteBody(note, 'text');
    registerNote(catalog, 'id-1');
    recordDelete(catalog, 'id-1', note);
    expect(isNoteDeleted(catalogMap(catalog).get('id-1'), note)).toBe(true);
  });

  test('concurrent edit resurrects a deleted note after merge, on both devices', () => {
    const noteA = createNoteDoc();
    setNoteBody(noteA, 'base');
    const noteB = loadDocFromBlobs([encodeFullState(noteA)]);

    const catalogA = new Y.Doc();
    registerNote(catalogA, 'id-1');
    const catalogB = loadDocFromBlobs([encodeFullState(catalogA)]);

    recordDelete(catalogA, 'id-1', noteA);
    noteBody(noteB).insert(0, 'concurrent edit ');

    const mergedNote = loadDocFromBlobs([encodeFullState(noteA), encodeFullState(noteB)]);
    const mergedCatalog = loadDocFromBlobs([encodeFullState(catalogA), encodeFullState(catalogB)]);
    const entry = catalogMap(mergedCatalog).get('id-1');
    expect(isNoteDeleted(entry, mergedNote)).toBe(false);
  });

  test('delete after seeing the edit stays deleted', () => {
    const note = createNoteDoc();
    setNoteBody(note, 'base');
    noteBody(note).insert(0, 'edited ');
    const catalog = new Y.Doc();
    registerNote(catalog, 'id-1');
    recordDelete(catalog, 'id-1', note);
    expect(isNoteDeleted(catalogMap(catalog).get('id-1'), note)).toBe(true);
  });
});
