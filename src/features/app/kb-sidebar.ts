import { css, html, LitElement, nothing } from 'lit';
import type { NoteSnapshot } from '@core/crdt/noteDoc';
import { searchNotes, type KnowledgeIndex } from '@features/search/indexes';
import type { SyncStatus } from './appController';

/**
 * Sidebar (US-4, US-5): search, note list, tag list with counts, sync status.
 * Pure projection of properties; every intent is an event to kb-app.
 */
export class KbSidebar extends LitElement {
  static override properties = {
    index: { attribute: false },
    selectedId: { type: String },
    query: { type: String },
    tagFilter: { type: String },
    syncStatus: { attribute: false },
    syncConfigured: { type: Boolean },
    saveState: { type: String },
  };

  declare index: KnowledgeIndex;
  declare selectedId: string;
  declare query: string;
  declare tagFilter: string;
  declare syncStatus: SyncStatus;
  declare syncConfigured: boolean;
  declare saveState: 'saved' | 'dirty' | 'saving';

  constructor() {
    super();
    this.selectedId = '';
    this.query = '';
    this.tagFilter = '';
    this.syncStatus = { state: 'idle' };
    this.syncConfigured = false;
    this.saveState = 'saved';
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      height: 100%;
      padding: var(--space-3);
      box-sizing: border-box;
      overflow: hidden;
    }
    input[type='search'] {
      padding: var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-bg);
      color: var(--color-text);
      width: 100%;
      box-sizing: border-box;
    }
    .actions {
      display: flex;
      gap: var(--space-2);
    }
    button {
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      cursor: pointer;
      font-size: 0.85rem;
    }
    button.primary {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-accent-contrast);
    }
    nav {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    li a {
      display: block;
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm);
      color: var(--color-text);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    li a:hover {
      background: var(--color-surface);
    }
    li a[aria-current='page'] {
      background: var(--color-accent-soft);
      color: var(--color-accent-strong);
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      max-height: 8rem;
      overflow-y: auto;
    }
    .tag {
      font-size: 0.8rem;
      padding: 0 var(--space-1);
      border-radius: var(--radius-sm);
      border: 1px solid var(--color-border);
      background: var(--color-surface);
      cursor: pointer;
      color: var(--color-text-muted);
    }
    .tag[aria-pressed='true'] {
      background: var(--color-accent-soft);
      color: var(--color-accent-strong);
      border-color: var(--color-accent);
    }
    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      border-top: 1px solid var(--color-border);
      padding-top: var(--space-2);
      font-size: 0.85rem;
    }
    .sync-state {
      color: var(--color-text-muted);
    }
    .sync-state[data-state='error'] {
      color: var(--color-danger);
    }
    h2 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      margin: 0;
    }
  `;

  private visibleNotes(): ReadonlyArray<NoteSnapshot> {
    const byQuery = searchNotes(this.index, this.query);
    const tag = this.tagFilter;
    const tagged = tag === '' || tag === undefined ? byQuery : byQuery.filter((note) => (this.index.tags.get(tag) ?? []).includes(note.id));
    return [...tagged].sort((left, right) => left.title.localeCompare(right.title));
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private syncLabel(): string {
    switch (this.syncStatus.state) {
      case 'idle':
        return this.syncConfigured ? 'Sync ready' : 'Sync off';
      case 'syncing':
        return 'Syncing…';
      case 'ok':
        return 'Synced';
      case 'error':
        return `Sync error`;
    }
  }

  protected override render(): unknown {
    const notes = this.visibleNotes();
    return html`
      <div role="search">
        <input
          type="search"
          placeholder="Search notes… (Ctrl+K)"
          aria-label="Search notes"
          .value=${this.query}
          @input=${(event: InputEvent) =>
            this.emit('query-change', {
              query: event.target instanceof HTMLInputElement ? event.target.value : '',
            })}
        />
      </div>
      <div class="actions">
        <button class="primary" @click=${() => this.emit('note-create', {})}>+ New note</button>
        <button @click=${() => this.emit('vault-lock', {})}>Lock</button>
      </div>
      <nav aria-label="Notes">
        <ul>
          ${notes.map(
            (note) => html`<li>
              <a
                href=${`#/note/${note.id}`}
                aria-current=${note.id === this.selectedId ? 'page' : nothing}
                >${note.title === '' ? 'Untitled' : note.title}</a
              >
            </li>`,
          )}
        </ul>
        ${notes.length === 0 ? html`<p style="color: var(--color-text-muted)">No notes match.</p>` : nothing}
      </nav>
      <section aria-label="Tags">
        <h2>Tags</h2>
        <div class="tags">
          ${[...this.index.tags.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(
              ([tag, ids]) => html`<button
                class="tag"
                aria-pressed=${tag === this.tagFilter ? 'true' : 'false'}
                @click=${() => this.emit('tag-toggle', { tag })}
              >
                #${tag} (${ids.length})
              </button>`,
            )}
        </div>
      </section>
      <footer>
        <span class="sync-state" aria-live="polite">
          <span data-state=${this.syncStatus.state} title=${this.syncStatus.state === 'error' ? this.syncStatus.message : ''}>${this.syncLabel()}</span>
          · ${this.saveState === 'saved' ? 'Saved' : this.saveState === 'saving' ? 'Saving…' : 'Editing…'}
        </span>
        <span>
          <button @click=${() => this.emit('sync-open-settings', {})}>Settings</button>
          <button ?disabled=${!this.syncConfigured || this.syncStatus.state === 'syncing'} @click=${() => this.emit('sync-now', {})}>
            Sync
          </button>
        </span>
      </footer>
    `;
  }
}

customElements.define('kb-sidebar', KbSidebar);
