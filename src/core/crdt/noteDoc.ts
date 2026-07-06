import * as Y from 'yjs';

export type NoteId = string;

export type NoteSnapshot = {
  readonly id: NoteId;
  readonly title: string;
  readonly body: string;
};

export const newNoteId = (): NoteId => crypto.randomUUID();

export const createNoteDoc = (): Y.Doc => new Y.Doc();

export const noteTitle = (doc: Y.Doc): Y.Text => doc.getText('title');

export const noteBody = (doc: Y.Doc): Y.Text => doc.getText('body');

export const snapshotNote = (id: NoteId, doc: Y.Doc): NoteSnapshot => ({
  id,
  title: noteTitle(doc).toString(),
  body: noteBody(doc).toString(),
});

export const setNoteTitle = (doc: Y.Doc, title: string): void =>
  doc.transact(() => {
    const text = noteTitle(doc);
    text.delete(0, text.length);
    text.insert(0, title);
  });

export const setNoteBody = (doc: Y.Doc, body: string): void =>
  doc.transact(() => {
    const text = noteBody(doc);
    text.delete(0, text.length);
    text.insert(0, body);
  });

/** Load a doc from any set of update blobs, in any order (AC-8.5). */
export const loadDocFromBlobs = (blobs: ReadonlyArray<Uint8Array>): Y.Doc => {
  const doc = new Y.Doc();
  for (const blob of blobs) Y.applyUpdate(doc, blob);
  return doc;
};

/** One compact blob equivalent to the given updates (append-only flush unit). */
export const mergeUpdateBlobs = (blobs: ReadonlyArray<Uint8Array>): Uint8Array =>
  Y.mergeUpdates([...blobs]);

export const encodeFullState = (doc: Y.Doc): Uint8Array => Y.encodeStateAsUpdate(doc);
