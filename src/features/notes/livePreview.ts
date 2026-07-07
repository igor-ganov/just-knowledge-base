import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { parseWikiLinks, type WikiLink } from '@core/parser/noteTokens';

/**
 * Obsidian-style live preview (spec live-preview-editor): the document renders
 * as formatted text; the markup of the element under the caret is revealed —
 * a "window into the source" that follows the cursor. One mode, no edit/preview
 * split (AC-L1).
 */
export type LivePreviewHooks = {
  readonly resolveTitle: (title: string) => string | undefined;
  readonly openNote: (noteId: string) => void;
  readonly createNote: (title: string) => void;
};

class WikiLinkWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly noteId: string | undefined,
    private readonly hooks: LivePreviewHooks,
  ) {
    super();
  }

  override eq(other: WikiLinkWidget): boolean {
    return other.label === this.label && other.noteId === this.noteId;
  }

  override toDOM(): HTMLElement {
    const link = document.createElement('span');
    link.textContent = this.label;
    link.setAttribute('role', 'link');
    link.tabIndex = 0;
    link.className = this.noteId === undefined ? 'cm-wikilink cm-wikilink-unresolved' : 'cm-wikilink';
    const activate = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
      if (this.noteId === undefined) {
        this.hooks.createNote(this.label);
      } else {
        this.hooks.openNote(this.noteId);
      }
    };
    link.addEventListener('click', activate);
    link.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') activate(event);
    });
    return link;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const bullet = document.createElement('span');
    bullet.className = 'cm-bullet';
    bullet.textContent = '•';
    return bullet;
  }
}

const HEADING_LEVELS: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
};

const TAG_PATTERN = /(?:^|\s)(#[\p{L}\p{N}][\p{L}\p{N}\-_/]*)/gu;

const buildDecorations = (view: EditorView, hooks: LivePreviewHooks): DecorationSet => {
  const decorations: Range<Decoration>[] = [];
  const touches = (from: number, to: number): boolean =>
    view.state.selection.ranges.some((range) => range.from <= to && range.to >= from);

  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        const level = HEADING_LEVELS[node.name];
        if (level !== undefined) {
          const line = view.state.doc.lineAt(node.from);
          decorations.push(Decoration.line({ class: `cm-live-h${level}` }).range(line.from));
          const mark = node.node.getChild('HeaderMark');
          if (mark !== null && !touches(node.from, node.to)) {
            const markEnd = Math.min(mark.to + 1, node.to);
            decorations.push(Decoration.replace({}).range(mark.from, markEnd));
          }
          return;
        }
        switch (node.name) {
          case 'StrongEmphasis':
          case 'Emphasis': {
            const cls = node.name === 'Emphasis' ? 'cm-live-em' : 'cm-live-strong';
            decorations.push(Decoration.mark({ class: cls }).range(node.from, node.to));
            if (!touches(node.from, node.to)) {
              for (const mark of node.node.getChildren('EmphasisMark')) {
                decorations.push(Decoration.replace({}).range(mark.from, mark.to));
              }
            }
            return;
          }
          case 'InlineCode': {
            decorations.push(Decoration.mark({ class: 'cm-live-code' }).range(node.from, node.to));
            if (!touches(node.from, node.to)) {
              for (const mark of node.node.getChildren('CodeMark')) {
                decorations.push(Decoration.replace({}).range(mark.from, mark.to));
              }
            }
            return;
          }
          case 'FencedCode': {
            const first = view.state.doc.lineAt(node.from).number;
            const last = view.state.doc.lineAt(node.to).number;
            for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
              decorations.push(
                Decoration.line({ class: 'cm-live-codeblock' }).range(view.state.doc.line(lineNumber).from),
              );
            }
            return;
          }
          case 'ListMark': {
            const markText = view.state.doc.sliceString(node.from, node.to);
            const line = view.state.doc.lineAt(node.from);
            if (/^[-*]$/u.test(markText) && !touches(line.from, line.to)) {
              decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
            }
            return;
          }
          case 'Blockquote': {
            const first = view.state.doc.lineAt(node.from).number;
            const last = view.state.doc.lineAt(node.to).number;
            for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
              decorations.push(
                Decoration.line({ class: 'cm-live-quote' }).range(view.state.doc.line(lineNumber).from),
              );
            }
            return;
          }
          case 'Link': {
            if (!touches(node.from, node.to)) {
              for (const child of node.node.getChildren('LinkMark')) {
                decorations.push(Decoration.replace({}).range(child.from, child.to));
              }
              const url = node.node.getChild('URL');
              if (url !== null) {
                const closeParen = Math.min(url.to + 1, node.to);
                decorations.push(Decoration.replace({}).range(url.from - 1, closeParen));
              }
            }
            decorations.push(Decoration.mark({ class: 'cm-live-link' }).range(node.from, node.to));
            return;
          }
          default:
            return;
        }
      },
    });

    const text = view.state.doc.sliceString(visible.from, visible.to);
    let searchFrom = 0;
    for (const link of parseWikiLinks(text)) {
      const index = text.indexOf(link.raw, searchFrom);
      if (index === -1) continue;
      searchFrom = index + link.raw.length;
      const start = visible.from + index;
      const end = start + link.raw.length;
      if (touches(start, end)) continue;
      const target = wikiTarget(link, hooks);
      decorations.push(
        Decoration.replace({ widget: new WikiLinkWidget(target.label, target.noteId, hooks) }).range(start, end),
      );
    }
    for (const match of text.matchAll(TAG_PATTERN)) {
      const tag = match[1] ?? '';
      const start = visible.from + (match.index ?? 0) + (match[0]?.length ?? 0) - tag.length;
      decorations.push(Decoration.mark({ class: 'cm-live-tag' }).range(start, start + tag.length));
    }
  }
  return Decoration.set(decorations, true);
};

const wikiTarget = (
  link: WikiLink,
  hooks: LivePreviewHooks,
): { readonly label: string; readonly noteId: string | undefined } =>
  link.kind === 'id'
    ? { label: link.label, noteId: link.noteId }
    : { label: link.title, noteId: hooks.resolveTitle(link.title) };

export const livePreview = (hooks: LivePreviewHooks) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, hooks);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, hooks);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
