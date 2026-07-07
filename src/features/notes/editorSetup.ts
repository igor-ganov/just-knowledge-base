import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import type * as Y from 'yjs';
import type { KnowledgeIndex } from '@features/search/indexes';
import { livePreview, type LivePreviewHooks } from './livePreview';

/**
 * CodeMirror ⇄ Y.Text binding (design §7). The Y.Text is the source of truth;
 * editor changes apply to it inside 'editor'-tagged transactions, and every
 * non-editor transaction (disk load, sync merge) is translated back into
 * editor changes — so remote edits land live in an open editor.
 */
const EDITOR_ORIGIN = 'editor';

type PendingChange = { readonly fromA: number; readonly toA: number; readonly text: string };

const pushEditorChangesToY = (ytext: Y.Text) =>
  EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const doc = ytext.doc;
    if (doc === null) return;
    const pending: PendingChange[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      pending.push({ fromA, toA, text: inserted.toString() });
    });
    if (ytext.toString() === update.state.doc.toString()) return;
    doc.transact(() => {
      for (const change of pending.toReversed()) {
        if (change.toA > change.fromA) ytext.delete(change.fromA, change.toA - change.fromA);
        if (change.text !== '') ytext.insert(change.fromA, change.text);
      }
    }, EDITOR_ORIGIN);
  });

const observeYIntoEditor = (ytext: Y.Text, view: EditorView): (() => void) => {
  const observer = (event: Y.YTextEvent): void => {
    if (event.transaction.origin === EDITOR_ORIGIN) return;
    const changes: Array<{ from: number; to: number; insert?: string }> = [];
    let position = 0;
    for (const op of event.delta) {
      switch (true) {
        case typeof op.retain === 'number': {
          position += op.retain ?? 0;
          break;
        }
        case typeof op.insert === 'string': {
          changes.push({ from: position, to: position, insert: String(op.insert) });
          break;
        }
        case typeof op.delete === 'number': {
          changes.push({ from: position, to: position + (op.delete ?? 0) });
          position += op.delete ?? 0;
          break;
        }
        default:
          break;
      }
    }
    if (changes.length > 0) view.dispatch({ changes });
  };
  ytext.observe(observer);
  return () => ytext.unobserve(observer);
};

/** `[[` autocomplete over existing note titles (AC-3.3); applies the id-form link. */
const wikiLinkCompletion =
  (getIndex: () => KnowledgeIndex) =>
  (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[([^\][]*)$/u);
    if (match === null) return null;
    return {
      from: match.from + 2,
      filter: true,
      options: getIndex().snapshots.map((note) => ({
        label: note.title,
        type: 'text',
        apply: `${note.id}|${note.title}]]`,
      })),
    };
  };

export type EditorBinding = {
  readonly view: EditorView;
  readonly destroy: () => void;
};

export type EditorOptions = {
  readonly sourceMode: boolean;
  readonly hooks: LivePreviewHooks;
};

export const mountNoteEditor = (
  parent: HTMLElement,
  ytext: Y.Text,
  getIndex: () => KnowledgeIndex,
  options: EditorOptions,
): EditorBinding => {
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      history(),
      markdown(),
      autocompletion({ override: [wikiLinkCompletion(getIndex)] }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      placeholder('Write your note in Markdown. Link with [[, tag with #'),
      EditorView.lineWrapping,
      pushEditorChangesToY(ytext),
      ...(options.sourceMode ? [] : [livePreview(options.hooks)]),
    ],
  });
  const view = new EditorView({ state, parent });
  const unobserve = observeYIntoEditor(ytext, view);
  return {
    view,
    destroy: () => {
      unobserve();
      view.destroy();
    },
  };
};
