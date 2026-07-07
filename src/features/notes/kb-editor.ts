import { css, html, LitElement, nothing } from 'lit';
import type * as Y from 'yjs';
import { executeCommand } from '@core/commands/commandRegistry';
import { noteBody, noteTitle, type NoteId } from '@core/crdt/noteDoc';
import type { KnowledgeIndex } from '@features/search/indexes';
import { mountNoteEditor, type EditorBinding } from './editorSetup';

/**
 * Note editor pane (specs knowledge-base-mvp US-2/US-3 + live-preview-editor):
 * a single live-preview surface — formatted text with a source window at the
 * caret — plus title, folder move, backlinks. A Source toggle shows raw
 * markdown for the whole document.
 */
export class KbEditor extends LitElement {
  static override properties = {
    noteId: { type: String },
    doc: { attribute: false },
    index: { attribute: false },
    folders: { attribute: false },
    folderId: { type: String },
    space: { type: String },
    sourceMode: { type: Boolean, state: true },
  };

  declare noteId: NoteId;
  declare doc: Y.Doc | undefined;
  declare index: KnowledgeIndex;
  declare folders: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  declare folderId: string;
  declare space: 'private' | 'public';
  declare sourceMode: boolean;

  private binding: EditorBinding | undefined;
  private subscribedDoc: Y.Doc | undefined;
  private onDocChange = (): void => this.requestUpdate();

  constructor() {
    super();
    this.sourceMode = false;
    this.folders = [];
    this.folderId = '';
    this.space = 'private';
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
      padding-left: calc(var(--space-3) + 3rem);
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
    select {
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      font-size: 0.85rem;
      max-width: 9rem;
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
      font-size: 1rem;
    }
    .editor-host .cm-content {
      max-width: 48rem;
      padding: var(--space-3) var(--space-4);
      line-height: 1.65;
    }
    .editor-host .cm-live-h1 {
      font-size: 1.7em;
      font-weight: 700;
    }
    .editor-host .cm-live-h2 {
      font-size: 1.4em;
      font-weight: 700;
    }
    .editor-host .cm-live-h3 {
      font-size: 1.2em;
      font-weight: 600;
    }
    .editor-host .cm-live-h4,
    .editor-host .cm-live-h5,
    .editor-host .cm-live-h6 {
      font-weight: 600;
    }
    .editor-host .cm-live-strong {
      font-weight: 700;
    }
    .editor-host .cm-live-em {
      font-style: italic;
    }
    .editor-host .cm-live-code,
    .editor-host .cm-live-codeblock {
      font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
      background: var(--color-surface);
      border-radius: 3px;
    }
    .editor-host .cm-live-quote {
      border-left: 3px solid var(--color-accent);
      padding-left: var(--space-2);
      color: var(--color-text-muted);
    }
    .editor-host .cm-live-link {
      color: var(--color-accent-strong);
      text-decoration: underline;
    }
    .editor-host .cm-wikilink {
      color: var(--color-accent-strong);
      text-decoration: underline;
      cursor: pointer;
    }
    .editor-host .cm-wikilink-unresolved {
      color: var(--color-danger);
      text-decoration-style: dashed;
    }
    .editor-host .cm-live-tag {
      color: var(--color-accent-strong);
      background: var(--color-accent-soft);
      border-radius: 3px;
    }
    .editor-host .cm-bullet {
      color: var(--color-accent);
      font-weight: 700;
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
    if (changed.has('doc')) {
      this.subscribedDoc?.off('update', this.onDocChange);
      this.doc?.on('update', this.onDocChange);
      this.subscribedDoc = this.doc;
    }
    if (changed.has('noteId') || changed.has('doc') || changed.has('sourceMode')) {
      this.teardownEditor();
      const host = this.renderRoot.querySelector('.editor-host');
      const doc = this.doc;
      if (host instanceof HTMLElement && doc !== undefined) {
        this.binding = mountNoteEditor(host, noteBody(doc), () => this.index, {
          sourceMode: this.sourceMode,
          hooks: {
            resolveTitle: (title) => this.index.titleToId.get(title.toLowerCase()),
            openNote: (noteId) => this.emit('note-open', { id: noteId }),
            createNote: (title) => this.emit('note-create-titled', { title }),
          },
        });
      }
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
    return html`
      <header>
        <input
          class="title"
          aria-label="Note title"
          placeholder="Untitled"
          .value=${noteTitle(doc).toString()}
          @input=${this.onTitleInput}
        />
        <select
          aria-label="Note space"
          .value=${this.space}
          @change=${(event: Event) => {
            const value = event.target instanceof HTMLSelectElement ? event.target.value : 'private';
            this.emit('note-space', { id: this.noteId, space: value });
          }}
        >
          <option value="private" ?selected=${this.space === 'private'}>🔒 Private</option>
          <option value="public" ?selected=${this.space === 'public'}>🌐 Public</option>
        </select>
        <select
          aria-label="Move to folder"
          .value=${this.folderId}
          @change=${(event: Event) => {
            const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
            this.emit('note-move', { id: this.noteId, folderId: value });
          }}
        >
          <option value="">(root)</option>
          ${this.folders.map(
            (folder) => html`<option value=${folder.id} ?selected=${folder.id === this.folderId}>${folder.name}</option>`,
          )}
        </select>
        <button
          aria-pressed=${this.sourceMode ? 'true' : 'false'}
          @click=${() => {
            this.sourceMode = !this.sourceMode;
          }}
        >
          ${this.sourceMode ? 'Live' : 'Source'}
        </button>
        <button @click=${() => void executeCommand('note.delete')}>Delete</button>
      </header>
      <div class="body">
        <div class="editor-host"></div>
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
