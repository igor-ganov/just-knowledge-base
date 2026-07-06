import MiniSearch from 'minisearch';
import type { NoteId, NoteSnapshot } from '@core/crdt/noteDoc';
import { parseTags, parseWikiLinks } from '@core/parser/noteTokens';

/**
 * In-memory knowledge indexes (US-3, US-4, US-5): search, links, backlinks,
 * tags. Built from decrypted snapshots at unlock and rebuilt on change; lives
 * only in RAM and dies with the session (AC-5.2, AC-9.2).
 */
export type KnowledgeIndex = {
  readonly search: MiniSearch<NoteSnapshot>;
  readonly titleToId: ReadonlyMap<string, NoteId>;
  readonly backlinks: ReadonlyMap<NoteId, ReadonlyArray<NoteId>>;
  readonly tags: ReadonlyMap<string, ReadonlyArray<NoteId>>;
  readonly snapshots: ReadonlyArray<NoteSnapshot>;
};

const forwardLinks = (
  note: NoteSnapshot,
  titleToId: ReadonlyMap<string, NoteId>,
): ReadonlyArray<NoteId> =>
  parseWikiLinks(note.body)
    .map((link) => (link.kind === 'id' ? link.noteId : titleToId.get(link.title.toLowerCase())))
    .filter((id): id is NoteId => id !== undefined && id !== note.id);

export const buildIndex = (snapshots: ReadonlyArray<NoteSnapshot>): KnowledgeIndex => {
  const search = new MiniSearch<NoteSnapshot>({
    fields: ['title', 'body'],
    storeFields: ['title'],
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.15 },
  });
  search.addAll([...snapshots]);

  const titleToId = new Map(snapshots.map((note) => [note.title.toLowerCase(), note.id]));

  const backlinks = new Map<NoteId, NoteId[]>();
  for (const note of snapshots) {
    for (const target of new Set(forwardLinks(note, titleToId))) {
      backlinks.set(target, [...(backlinks.get(target) ?? []), note.id]);
    }
  }

  const tags = new Map<string, NoteId[]>();
  for (const note of snapshots) {
    for (const tag of parseTags(note.body)) {
      tags.set(tag, [...(tags.get(tag) ?? []), note.id]);
    }
  }

  return { search, titleToId, backlinks, tags, snapshots };
};

export const searchNotes = (index: KnowledgeIndex, query: string): ReadonlyArray<NoteSnapshot> => {
  const trimmed = query.trim();
  const byId = new Map(index.snapshots.map((note) => [note.id, note]));
  return trimmed === ''
    ? index.snapshots
    : index.search
        .search(trimmed)
        .map((result) => byId.get(String(result.id)))
        .filter((note): note is NoteSnapshot => note !== undefined);
};

export const emptyIndex = (): KnowledgeIndex => buildIndex([]);
