/**
 * Wiki-link and tag extraction (US-3, US-4). Links carry note identity, not the
 * title string (AC-3.5): the stored form is `[[<uuid>|Title]]`; a bare
 * `[[Title]]` is a title-form link that resolves by exact title or stays
 * unresolved (AC-3.2).
 */
export type WikiLink =
  | { readonly kind: 'id'; readonly noteId: string; readonly label: string; readonly raw: string }
  | { readonly kind: 'title'; readonly title: string; readonly raw: string };

const LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/gu;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TAG_PATTERN = /(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}\-_/]*)/gu;

export const parseWikiLinks = (text: string): ReadonlyArray<WikiLink> =>
  [...text.matchAll(LINK_PATTERN)].map((match) => {
    const raw = match[0];
    const head = (match[1] ?? '').trim();
    const label = match[2];
    switch (true) {
      case UUID_PATTERN.test(head):
        return { kind: 'id' as const, noteId: head, label: label ?? head, raw };
      default:
        return { kind: 'title' as const, title: head, raw };
    }
  });

export const parseTags = (text: string): ReadonlyArray<string> => {
  const tags = [...text.matchAll(TAG_PATTERN)].map((match) => (match[1] ?? '').toLowerCase());
  return [...new Set(tags)];
};

export const idLinkFor = (noteId: string, title: string): string => `[[${noteId}|${title}]]`;

/** Editor/preview display form: the label of an id-link, the title of a title-link. */
export const linkLabel = (link: WikiLink): string =>
  link.kind === 'id' ? link.label : link.title;
