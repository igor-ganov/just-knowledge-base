import { css, html, LitElement, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type * as Y from 'yjs';
import { noteBody, noteTitle, type NoteId } from '@core/crdt/noteDoc';
import { renderMarkdown } from '@core/markdown/render';
import type { KnowledgeIndex } from '@features/search/indexes';
import { mountNoteEditor, type EditorBinding } from './editorSetup';

/**
 * Note editor pane (US-2, US-3): title input, CodeMirror source editor bound
 * to the note's Y.Text, Markdown preview toggle, backlinks panel.
 */
export class KbEditor extends LitElement {
  static override properties = {
    noteId: { type: String },
    doc: { attribute: false },
    index: { attribute: false },
    preview: { type: Boolean, state: true },
  };

  declare noteId: NoteId;
  declare doc: Y.Doc | undefined;
  declare index: KnowledgeIndex;
  declare preview: boolean;

  private binding: EditorBinding | undefined;
  private subscribedDoc: Y.Doc | undefined;
  private refreshPreview = (): void => {
    if (this.preview) this.requestUpdate();
  };

  constructor() {
    super();
    this.preview = false;
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 0;
      box-sizing: border-box;
    }
    header {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      padding: var(--space-3);
      border-bottom: 1px solid var(--color-border);
    }
    input.title {
      flex: 1;
      font-size: 1.3rem;
      font-weight: 600;
      border: none;
      background: transparent;
      color: var(--color-text);
      outline-offset: 4px;
      min-width: 0;
    }
    button {
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      cursor: pointer;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    button[aria-pressed='true'] {
      background: var(--color-accent-soft);
      border-color: var(--color-accent);
      color: var(--color-accent-strong);
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .editor-host {
      flex: 1;
      min-height: 0;
    }
    .editor-host .cm-editor {
      height: 100%;
      font-size: 0.95rem;
    }
    .preview {
      padding: var(--space-3) var(--space-4);
      line-height: 1.6;
      max-width: 48rem;
    }
    .preview pre {
      background: var(--color-surface);
      padding: var(--space-2);
      border-radius: var(--radius-sm);
      overflow-x: auto;
    }
    .preview a.wiki-link {
      color: var(--color-accent-strong);
    }
    .preview a.wiki-link--unresolved {
      color: var(--color-danger);
      text-decoration-style: dashed;
    }
    aside {
      border-top: 1px solid var(--color-border);
      padding: var(--space-2) var(--space-3);
      font-size: 0.85rem;
    }
    aside h2 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      margin: 0 0 var(--space-1);
    }
    aside ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    aside a {
      color: var(--color-accent-strong);
    }
    .empty {
      display: grid;
      place-items: center;
      height: 100%;
      color: var(--color-text-muted);
    }
  `;

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardownEditor();
  }

  private teardownEditor(): void {
    this.binding?.destroy();
    this.binding = undefined;
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has('noteId') || changed.has('doc') || changed.has('preview')) {
      this.teardownEditor();
      const host = this.renderRoot.querySelector('.editor-host');
      const doc = this.doc;
      if (!this.preview && host instanceof HTMLElement && doc !== undefined) {
        this.binding = mountNoteEditor(host, noteBody(doc), () => this.index);
      }
    }
    if (changed.has('doc')) {
      this.subscribedDoc?.off('update', this.refreshPreview);
      this.doc?.on('update', this.refreshPreview);
      this.subscribedDoc = this.doc;
    }
  }

  private onTitleInput(event: InputEvent): void {
    const doc = this.doc;
    if (doc === undefined || !(event.target instanceof HTMLInputElement)) return;
    const text = noteTitle(doc);
    const value = event.target.value;
    doc.transact(() => {
      text.delete(0, text.length);
      text.insert(0, value);
    });
  }

  private onPreviewClick(event: Event): void {
    const path = event.composedPath();
    const anchor = path.find(
      (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
    );
    if (anchor === undefined) return;
    const noteId = anchor.dataset['noteId'];
    const createTitle = anchor.dataset['createTitle'];
    if (noteId !== undefined) {
      event.preventDefault();
      this.emit('note-open', { id: noteId });
    }
    if (createTitle !== undefined) {
      event.preventDefault();
      this.emit('note-create-titled', { title: createTitle });
    }
  }

  private backlinkEntries(): ReadonlyArray<{ id: string; title: string }> {
    const sources = this.index.backlinks.get(this.noteId) ?? [];
    return sources
      .map((id) => this.index.snapshots.find((note) => note.id === id))
      .filter((note): note is NonNullable<typeof note> => note !== undefined)
      .map((note) => ({ id: note.id, title: note.title === '' ? 'Untitled' : note.title }));
  }

  protected override render(): unknown {
    const doc = this.doc;
    if (doc === undefined) {
      return html`<div class="empty"><p>Select a note or create a new one.</p></div>`;
    }
    const backlinks = this.backlinkEntries();
    const resolve = ({ value }: { readonly kind: 'title'; readonly value: string }) => {
      const id = this.index.titleToId.get(value.toLowerCase());
      return id === undefined ? undefined : { noteId: id };
    };
    return html`
      <header>
        <input
          class="title"
          aria-label="Note title"
          placeholder="Untitled"
          .value=${noteTitle(doc).toString()}
          @input=${this.onTitleInput}
        />
        <button aria-pressed=${this.preview ? 'true' : 'false'} @click=${() => { this.preview = !this.preview; }}>
          ${this.preview ? 'Edit' : 'Preview'}
        </button>
        <button @click=${() => this.emit('note-delete', { id: this.noteId })}>Delete</button>
      </header>
      <div class="body">
        ${this.preview
          ? html`<div class="preview" @click=${this.onPreviewClick}>
              ${unsafeHTML(renderMarkdown(noteBody(doc).toString(), resolve))}
            </div>`
          : html`<div class="editor-host"></div>`}
      </div>
      ${backlinks.length > 0
        ? html`<aside aria-label="Backlinks">
            <h2>Linked from</h2>
            <ul>
              ${backlinks.map(
                (entry) => html`<li><a href=${`#/note/${entry.id}`}>${entry.title}</a></li>`,
              )}
            </ul>
          </aside>`
        : nothing}
    `;
  }
}

customElements.define('kb-editor', KbEditor);
