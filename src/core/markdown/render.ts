import { linkLabel, parseWikiLinks, type WikiLink } from '../parser/noteTokens';

/**
 * Minimal, XSS-safe Markdown renderer covering the AC-2.3 subset: headings,
 * emphasis, lists, code blocks, links — plus wiki-links as navigable elements.
 * All input is HTML-escaped before any markup is emitted; only markup produced
 * here reaches the DOM (security-hardening: no third-party HTML paths).
 */
export type LinkResolution = { readonly noteId: string } | undefined;
export type ResolveLink = (query: { readonly kind: 'title'; readonly value: string }) => LinkResolution;

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Placeholder that survives escaping untouched; stripped from user text first. */
const SENTINEL = '\u0000';

const wikiLinkHtml = (resolve: ResolveLink, link: WikiLink): string => {
  const label = escapeHtml(linkLabel(link));
  const hit = link.kind === 'id' ? { noteId: link.noteId } : resolve({ kind: 'title', value: link.title });
  return hit === undefined
    ? `<a href="#/new/${encodeURIComponent(linkLabel(link))}" class="wiki-link wiki-link--unresolved" data-create-title="${label}">${label}</a>`
    : `<a href="#/note/${hit.noteId}" class="wiki-link" data-note-id="${hit.noteId}">${label}</a>`;
};

const renderInline = (text: string, resolve: ResolveLink): string => {
  const links = parseWikiLinks(text);
  const tokenized = links.reduce(
    (acc, link, index) => acc.replace(link.raw, `${SENTINEL}${index}${SENTINEL}`),
    text.replaceAll(SENTINEL, ''),
  );
  const rendered = escapeHtml(tokenized)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/gu, '<em>$1</em>')
    .replace(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}\-_/]*)/gu, '$1<a href="#/tag/$2" class="tag-link">#$2</a>')
    .replace(
      /\[([^\]]+)\]\((https?:[^)\s]+)\)/gu,
      '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
    );
  return rendered.replace(/\u0000(\d+)\u0000/gu, (whole, index: string) => {
    const link = links[Number(index)];
    return link === undefined ? whole : wikiLinkHtml(resolve, link);
  });
};

type Block =
  | { readonly kind: 'code'; readonly lines: ReadonlyArray<string> }
  | { readonly kind: 'ul' | 'ol'; readonly items: ReadonlyArray<string> }
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'p'; readonly lines: ReadonlyArray<string> };

const BLOCK_START = /^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s)/u;

const toBlocks = (lines: ReadonlyArray<string>): ReadonlyArray<Block> => {
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    switch (true) {
      case line.startsWith('```'): {
        const closing = lines.findIndex((candidate, at) => at > index && candidate.startsWith('```'));
        const end = closing === -1 ? lines.length : closing;
        blocks.push({ kind: 'code', lines: lines.slice(index + 1, end) });
        index = end + 1;
        break;
      }
      case /^#{1,6}\s/u.test(line): {
        const level = (line.match(/^#+/u)?.[0] ?? '#').length;
        blocks.push({ kind: 'heading', level, text: line.slice(level + 1) });
        index += 1;
        break;
      }
      case /^\s*[-*]\s/u.test(line) || /^\s*\d+\.\s/u.test(line): {
        const ordered = /^\s*\d+\.\s/u.test(line);
        const itemPattern = ordered ? /^\s*\d+\.\s/u : /^\s*[-*]\s/u;
        const items: string[] = [];
        while (index < lines.length && itemPattern.test(lines[index] ?? '')) {
          items.push((lines[index] ?? '').replace(itemPattern, ''));
          index += 1;
        }
        blocks.push({ kind: ordered ? 'ol' : 'ul', items });
        break;
      }
      case line.trim() === '': {
        index += 1;
        break;
      }
      default: {
        const paragraph: string[] = [];
        while (index < lines.length && (lines[index] ?? '').trim() !== '' && !BLOCK_START.test(lines[index] ?? '')) {
          paragraph.push(lines[index] ?? '');
          index += 1;
        }
        blocks.push({ kind: 'p', lines: paragraph });
        break;
      }
    }
  }
  return blocks;
};

const renderBlock = (resolve: ResolveLink) => (block: Block): string => {
  switch (block.kind) {
    case 'code':
      return `<pre><code>${escapeHtml(block.lines.join('\n'))}</code></pre>`;
    case 'heading': {
      const level = Math.min(block.level, 6);
      return `<h${level}>${renderInline(block.text, resolve)}</h${level}>`;
    }
    case 'ul':
    case 'ol': {
      const items = block.items.map((item) => `<li>${renderInline(item, resolve)}</li>`).join('');
      return `<${block.kind}>${items}</${block.kind}>`;
    }
    case 'p':
      return `<p>${block.lines.map((line) => renderInline(line, resolve)).join('<br>')}</p>`;
  }
};

export const renderMarkdown = (source: string, resolve: ResolveLink): string =>
  toBlocks(source.split('\n')).map(renderBlock(resolve)).join('');
