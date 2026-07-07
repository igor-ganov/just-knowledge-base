import { css, html, LitElement, nothing } from 'lit';
import { executeCommand } from '@core/commands/commandRegistry';
import type { NoteSnapshot } from '@core/crdt/noteDoc';
import type { FolderTree } from '@core/crdt/folders';
import { searchNotes, type KnowledgeIndex } from '@features/search/indexes';
import { commandLabel } from '@ui/commandChip';
import type { SpaceTrees, SyncStatus } from './appController';

/**
 * File panel (spec folders-and-shell, AC-F2.2): search, folder tree with
 * notes, tags, status. Slides in from the left; kb-app owns the open state.
 */
export class KbFilePanel extends LitElement {
  static override properties = {
    index: { attribute: false },
    tree: { attribute: false },
    selectedId: { type: String },
    query: { type: String },
    tagFilter: { type: String },
    syncStatus: { attribute: false },
    syncConfigured: { type: Boolean },
    saveState: { type: String },
    showHotkeys: { type: Boolean },
    userLogin: { type: String },
  };

  declare index: KnowledgeIndex;
  declare tree: SpaceTrees;
  declare selectedId: string;
  declare query: string;
  declare tagFilter: string;
  declare syncStatus: SyncStatus;
  declare syncConfigured: boolean;
  declare saveState: 'saved' | 'dirty' | 'saving';
  declare showHotkeys: boolean;
  declare userLogin: string;

  constructor() {
    super();
    const empty: FolderTree = { id: '', name: '', folders: [], notes: [] };
    this.tree = { private: empty, public: empty };
    this.selectedId = '';
    this.query = '';
    this.tagFilter = '';
    this.syncStatus = { state: 'idle' };
    this.syncConfigured = false;
    this.saveState = 'saved';
    this.showHotkeys = false;
    this.userLogin = '';
  }

  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      height: 100%;
      padding: var(--space-3);
      padding-top: calc(var(--space-3) + 3rem);
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
      flex-wrap: wrap;
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
    details {
      margin: 0;
    }
    details > ul,
    details > details {
      margin-left: var(--space-3);
    }
    summary {
      cursor: pointer;
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      gap: var(--space-1);
      font-weight: 500;
    }
    summary:hover {
      background: var(--color-surface);
    }
    summary .folder-add {
      margin-left: auto;
      border: none;
      background: none;
      color: var(--color-text-muted);
      font-size: 0.9rem;
      padding: 0 var(--space-1);
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      max-height: 7rem;
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
      flex-wrap: wrap;
    }
    .sync-state {
      color: var(--color-text-muted);
    }
    h2 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      margin: 0;
    }
  `;

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
        return 'Sync error';
    }
  }

  private saveLabel(): string {
    switch (this.saveState) {
      case 'saved':
        return 'Saved';
      case 'saving':
        return 'Saving…';
      case 'dirty':
        return 'Editing…';
    }
  }

  private noteRow(note: NoteSnapshot): unknown {
    return html`<li>
      <a href=${`#/note/${note.id}`} aria-current=${note.id === this.selectedId ? 'page' : nothing}
        >${note.title === '' ? 'Untitled' : note.title}</a
      >
    </li>`;
  }

  private folderNode(folder: FolderTree, space: 'private' | 'public'): unknown {
    return html`<details open>
      <summary>
        📁 ${folder.name}
        <button
          class="folder-add"
          aria-label=${`New note in ${folder.name}`}
          title="New note here"
          @click=${(event: Event) => {
            event.preventDefault();
            this.emit('note-create-in-folder', { folderId: folder.id, space });
          }}
        >
          ＋
        </button>
      </summary>
      ${folder.folders.map((child) => this.folderNode(child, space))}
      <ul>
        ${folder.notes.map((note) => this.noteRow(note))}
      </ul>
    </details>`;
  }

  private spaceSection(space: 'private' | 'public', tree: FolderTree): unknown {
    return html`<details open class="space">
      <summary>
        ${space === 'private' ? '🔒 Private' : '🌐 Public'}
        <button
          class="folder-add"
          aria-label=${`New folder in ${space} space`}
          title="New folder"
          @click=${(event: Event) => {
            event.preventDefault();
            this.emit('folder-create', { space });
          }}
        >
          ＋📁
        </button>
      </summary>
      ${tree.folders.map((folder) => this.folderNode(folder, space))}
      <ul>
        ${tree.notes.map((note) => this.noteRow(note))}
      </ul>
    </details>`;
  }

  private filteredList(): unknown {
    const tag = this.tagFilter;
    const byQuery = searchNotes(this.index, this.query);
    const notes =
      tag === '' ? byQuery : byQuery.filter((note) => (this.index.tags.get(tag) ?? []).includes(note.id));
    return html`<ul>
      ${[...notes]
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((note) => this.noteRow(note))}
      ${notes.length === 0 ? html`<li><p style="color: var(--color-text-muted)">No notes match.</p></li>` : nothing}
    </ul>`;
  }

  protected override render(): unknown {
    const filtering = this.query !== '' || this.tagFilter !== '';
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
        <button @click=${() => this.emit('folder-create', { space: 'private' })}>＋ Folder</button>
        <button @click=${() => void executeCommand('vault.lock')}>
          ${commandLabel('vault.lock', 'Lock', this.showHotkeys)}
        </button>
      </div>
      <nav aria-label="Notes">${filtering
        ? this.filteredList()
        : html`${this.spaceSection('private', this.tree.private)} ${this.spaceSection('public', this.tree.public)}`}
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
          ${this.userLogin === '' ? nothing : html`@${this.userLogin} · `}
          <span title=${this.syncStatus.state === 'error' ? this.syncStatus.message : ''}>${this.syncLabel()}</span>
          · ${this.saveLabel()}
        </span>
        <span>
          <button @click=${() => void executeCommand('settings.open')}>
            ${commandLabel('settings.open', 'Settings', this.showHotkeys)}
          </button>
          <button @click=${() => void executeCommand('sync.settings')}>
            ${commandLabel('sync.settings', 'Sync', this.showHotkeys)}
          </button>
          <button
            ?disabled=${!this.syncConfigured || this.syncStatus.state === 'syncing'}
            @click=${() => void executeCommand('sync.now')}
          >
            ${commandLabel('sync.now', 'Sync now', this.showHotkeys)}
          </button>
        </span>
      </footer>
    `;
  }
}

customElements.define('kb-file-panel', KbFilePanel);
