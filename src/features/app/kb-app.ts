import './polyfills';
import { css, html, LitElement, nothing } from 'lit';
import type { NoteId } from '@core/crdt/noteDoc';
import type { KnowledgeIndex } from '@features/search/indexes';
import type { SyncSettings } from '@features/sync/syncConfig';
import {
  addNote,
  autoLockMs,
  boot,
  createNewVault,
  indexStore,
  lock,
  phaseStore,
  queryStore,
  removeNote,
  resetIdleTimer,
  saveStateStore,
  saveSyncSettings,
  selectedNoteStore,
  setAutoLockMinutes,
  syncNow,
  syncSettingsStore,
  syncStatusStore,
  tagFilterStore,
  unlock,
  unlockErrorStore,
  vaultHandle,
  type Phase,
  type SyncStatus,
} from './appController';
import { KbSyncDialog } from '@features/sync/kb-sync-dialog';
import '@features/vault/kb-lock-screen';
import '@features/notes/kb-editor';
import '@features/sync/kb-sync-dialog';
import './kb-sidebar';

/**
 * Root element: routes lock/workspace, owns hash navigation, wires store
 * subscriptions and global activity listeners (idle auto-lock, AC-9.1).
 */
export class KbApp extends LitElement {
  static override properties = {
    phase: { type: String, state: true },
    busy: { type: Boolean, state: true },
  };

  declare phase: Phase;
  declare busy: boolean;

  private subscriptions: Array<() => void> = [];

  constructor() {
    super();
    this.phase = 'boot';
    this.busy = false;
  }

  static override styles = css`
    :host {
      display: block;
      height: 100dvh;
      background: var(--color-bg);
      color: var(--color-text);
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(14rem, 18rem) 1fr;
      height: 100%;
    }
    kb-sidebar {
      border-right: 1px solid var(--color-border);
      background: var(--color-bg-raised);
    }
    main {
      min-width: 0;
      height: 100%;
    }
    @media (max-width: 44rem) {
      .workspace {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(0, 40dvh) 1fr;
      }
      kb-sidebar {
        border-right: none;
        border-bottom: 1px solid var(--color-border);
      }
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    const rerender = (): void => this.requestUpdate();
    this.subscriptions = [
      phaseStore.subscribe((phase) => {
        this.phase = phase;
        this.busy = false;
        if (phase === 'unlocked') this.onHashChange();
      }),
      indexStore.subscribe(rerender),
      selectedNoteStore.subscribe(rerender),
      tagFilterStore.subscribe(rerender),
      queryStore.subscribe(rerender),
      syncStatusStore.subscribe(rerender),
      syncSettingsStore.subscribe(rerender),
      unlockErrorStore.subscribe(rerender),
      saveStateStore.subscribe(rerender),
    ];
    globalThis.addEventListener('hashchange', this.onHashChange);
    globalThis.addEventListener('pointerdown', resetIdleTimer);
    globalThis.addEventListener('keydown', this.onGlobalKey);
    void boot().then(() => this.onHashChange());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    globalThis.removeEventListener('hashchange', this.onHashChange);
    globalThis.removeEventListener('pointerdown', resetIdleTimer);
    globalThis.removeEventListener('keydown', this.onGlobalKey);
  }

  private onGlobalKey = (event: KeyboardEvent): void => {
    resetIdleTimer();
    if (!event.ctrlKey || this.phase !== 'unlocked') return;
    switch (event.key.toLowerCase()) {
      case 'k': {
        event.preventDefault();
        const search = this.renderRoot
          .querySelector('kb-sidebar')
          ?.shadowRoot?.querySelector('input[type="search"]');
        if (search instanceof HTMLInputElement) search.focus();
        return;
      }
      case 'n': {
        event.preventDefault();
        this.createUntitled();
        return;
      }
      case 'l': {
        event.preventDefault();
        void lock();
        return;
      }
      default:
        return;
    }
  };

  private onHashChange = (): void => {
    const hash = decodeURIComponent(globalThis.location.hash);
    const note = hash.match(/^#\/note\/(.+)$/u);
    const tag = hash.match(/^#\/tag\/(.+)$/u);
    const create = hash.match(/^#\/new\/(.+)$/u);
    if (note !== null && this.phase === 'unlocked') selectedNoteStore.set(note[1]);
    if (tag !== null) tagFilterStore.set(tag[1]);
    if (create !== null && this.phase === 'unlocked') {
      const created = addNote(create[1] ?? 'Untitled');
      globalThis.location.hash = created === undefined ? '' : `#/note/${created}`;
    }
  };

  private createUntitled(): void {
    const id = addNote('');
    if (id !== undefined) globalThis.location.hash = `#/note/${id}`;
  }

  private async handleCreate(event: CustomEvent<{ password: string }>): Promise<void> {
    this.busy = true;
    await createNewVault(event.detail.password);
  }

  private async handleUnlock(event: CustomEvent<{ password: string }>): Promise<void> {
    this.busy = true;
    await unlock(event.detail.password);
    this.busy = false;
  }

  private handleSyncSave(event: CustomEvent<{ settings: SyncSettings; autoLockMinutes: number }>): void {
    setAutoLockMinutes(event.detail.autoLockMinutes);
    void saveSyncSettings(event.detail.settings);
  }

  private renderWorkspace(index: KnowledgeIndex, selected: NoteId | undefined): unknown {
    const handle = vaultHandle();
    const doc = selected === undefined ? undefined : handle?.notes.get(selected);
    const settings = syncSettingsStore.get();
    const status: SyncStatus = syncStatusStore.get();
    return html`
      <div
        class="workspace"
        @note-create=${() => this.createUntitled()}
        @note-create-titled=${(event: CustomEvent<{ title: string }>) => {
          const id = addNote(event.detail.title);
          if (id !== undefined) globalThis.location.hash = `#/note/${id}`;
        }}
        @note-open=${(event: CustomEvent<{ id: string }>) => {
          globalThis.location.hash = `#/note/${event.detail.id}`;
        }}
        @note-delete=${(event: CustomEvent<{ id: string }>) => removeNote(event.detail.id)}
        @query-change=${(event: CustomEvent<{ query: string }>) => queryStore.set(event.detail.query)}
        @tag-toggle=${(event: CustomEvent<{ tag: string }>) =>
          tagFilterStore.update((current) => (current === event.detail.tag ? undefined : event.detail.tag))}
        @vault-lock=${() => void lock()}
        @sync-now=${() => void syncNow()}
        @sync-open-settings=${() => this.openSyncDialog()}
        @sync-save=${this.handleSyncSave}
      >
        <kb-sidebar
          .index=${index}
          .selectedId=${selected ?? ''}
          .query=${queryStore.get()}
          .tagFilter=${tagFilterStore.get() ?? ''}
          .syncStatus=${status}
          .syncConfigured=${settings !== undefined && settings.url !== ''}
          .saveState=${saveStateStore.get()}
        ></kb-sidebar>
        <main>
          <kb-editor .noteId=${selected ?? ''} .doc=${doc} .index=${index}></kb-editor>
        </main>
        <kb-sync-dialog .settings=${settings} .autoLockMinutes=${Math.round(autoLockMs() / 60000)}></kb-sync-dialog>
      </div>
    `;
  }

  private openSyncDialog(): void {
    const dialog = this.renderRoot.querySelector('kb-sync-dialog');
    if (dialog instanceof KbSyncDialog) dialog.show();
  }

  protected override render(): unknown {
    switch (this.phase) {
      case 'boot':
        return nothing;
      case 'no-vault':
        return html`<kb-lock-screen
          mode="create"
          ?busy=${this.busy}
          @vault-create=${this.handleCreate}
        ></kb-lock-screen>`;
      case 'locked':
        return html`<kb-lock-screen
          mode="unlock"
          ?busy=${this.busy}
          .error=${unlockErrorStore.get() ?? ''}
          @vault-unlock=${this.handleUnlock}
        ></kb-lock-screen>`;
      case 'unlocked':
        return this.renderWorkspace(indexStore.get(), selectedNoteStore.get());
    }
  }
}

customElements.define('kb-app', KbApp);
