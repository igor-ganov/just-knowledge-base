import * as Y from 'yjs';
import { fromBase64, toBase64 } from '../crypto/bytes';
import type { NoteId } from './noteDoc';

/**
 * Vault-level catalog (design §3.2). Entries are LWW values in a Y.Map; the
 * deterministic edit-wins-over-delete rule (AC-8.3) does NOT rely on LWW-kept
 * clocks (a concurrent writer's clock can be discarded by LWW). Instead a
 * tombstone snapshots the note doc's state vector at delete time; after any
 * merge, content the tombstone has not seen proves a concurrent-or-later edit
 * and resurrects the note. Every device projects the same status from the same
 * merged doc + catalog, so convergence is by construction.
 */
export type CatalogEntry = {
  readonly deleted: boolean;
  readonly tombstoneSvB64?: string;
};

const NOTES_KEY = 'notes';

export const catalogMap = (doc: Y.Doc): Y.Map<CatalogEntry> => doc.getMap(NOTES_KEY);

export const knownNoteIds = (doc: Y.Doc): ReadonlyArray<NoteId> => [...catalogMap(doc).keys()];

export const registerNote = (catalog: Y.Doc, id: NoteId): void =>
  catalog.transact(() => {
    catalogMap(catalog).set(id, { deleted: false });
  });

export const recordDelete = (catalog: Y.Doc, id: NoteId, noteDoc: Y.Doc): void =>
  catalog.transact(() => {
    catalogMap(catalog).set(id, {
      deleted: true,
      tombstoneSvB64: toBase64(Y.encodeStateVector(noteDoc)),
    });
  });

/** True iff `covering` has seen every struct that `other` contains. */
export const svCovers = (covering: Map<number, number>, other: Map<number, number>): boolean =>
  [...other].every(([client, clock]) => (covering.get(client) ?? 0) >= clock);

/**
 * Deterministic status projection. A deleted entry stays deleted only while its
 * tombstone covers the note doc; new content resurrects (edit wins over delete).
 * Character-deletion-only edits do not bump state vectors and thus do not
 * resurrect — documented rule.
 */
export const isNoteDeleted = (entry: CatalogEntry | undefined, noteDoc: Y.Doc): boolean => {
  switch (entry?.deleted) {
    case undefined:
    case false:
      return false;
    case true: {
      const tombstoneSvB64 = entry?.tombstoneSvB64;
      switch (tombstoneSvB64) {
        case undefined:
          return true;
        default: {
          const tombstoneSv = Y.decodeStateVector(fromBase64(tombstoneSvB64));
          const docSv = Y.decodeStateVector(Y.encodeStateVector(noteDoc));
          return svCovers(tombstoneSv, docSv);
        }
      }
    }
  }
};
