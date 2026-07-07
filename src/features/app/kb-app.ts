import './polyfills';
import { css, html, LitElement, nothing } from 'lit';
import { dispatchKeydown } from '@core/commands/commandRegistry';
import { getCondition, setCondition, subscribeCondition } from '@core/conditions/conditions';
import type { NoteId } from '@core/crdt/noteDoc';
import { KbSettingsDialog } from '@features/settings/kb-settings-dialog';
import { initSettings } from '@features/settings/settingsService';
import { bindConditionSources, CONDITIONS, registerAppCommands } from './commands';
import type { KnowledgeIndex } from '@features/search/indexes';
import type { SyncSettings } from '@features/sync/syncConfig';
import {
  addNote,
  autoLockMs,
  boot,
  createNewVault,
  enrollPasskeyForVault,
  indexStore,
  joinExistingVault,
  passkeyEnabledStore,
  passkeySupportedStore,
  phaseStore,
  settingsNoticeStore,
  queryStore,
  removeNote,
  resetIdleTimer,
  saveStateStore,
  saveSyncSettings,
  selectedNoteStore,
  setAutoLockMinutes,
  syncSettingsStore,
  syncStatusStore,
  tagFilterStore,
  unlock,
  unlockErrorStore,
  unlockWithPasskey,
  vaultHandle,
  type Phase,
  type SyncStatus,
} from './appController';
import { KbSyncDialog } from '@features/sync/kb-sync-dialog';
import '@features/vault/kb-lock-screen';
import '@features/notes/kb-editor';
import '@features/sync/kb-sync-dialog';
import '@features/settings/kb-settings-dialog';
import './kb-sidebar';

let appWiringDone = false;

/** One-time global wiring: settings, conditions, commands, key dispatcher. */
const wireAppOnce = (ui: Parameters<typeof registerAppCommands>[0]): void => {
  if (appWiringDone) return;
  appWiringDone = true;
  initSettings();
  bindConditionSources();
  registerAppCommands(ui);
};

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
    wireAppOnce({
      focusSearch: () => this.focusSearch(),
      newNote: () => this.createUntitled(),
      deleteCurrentNote: () => {
        const selected = selectedNoteStore.get();
        if (selected !== undefined) removeNote(selected);
      },
      openAppSettings: (section) => this.openAppSettings(section ?? 'general'),
      openSyncSettings: () => this.openSyncDialog(),
      toggleFilesPanel: () => setCondition(CONDITIONS.filesOpen, !getCondition(CONDITIONS.filesOpen)),
      unlockWithPasskey: () => void this.handlePasskeyUnlock(),
    });
    const rerender = (): void => this.requestUpdate();
    this.subscriptions = [
      subscribeCondition(CONDITIONS.showHotkeys, rerender),
      subscribeCondition(CONDITIONS.filesOpen, rerender),
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
      passkeySupportedStore.subscribe(rerender),
      passkeyEnabledStore.subscribe(rerender),
      settingsNoticeStore.subscribe(rerender),
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
    dispatchKeydown(event);
  };

  private focusSearch(): void {
    const search = this.renderRoot
      .querySelector('kb-sidebar')
      ?.shadowRoot?.querySelector('input[type="search"]');
    if (search instanceof HTMLInputElement) search.focus();
  }

  private openAppSettings(section: 'general' | 'hotkeys'): void {
    const dialog = this.renderRoot.querySelector('kb-settings-dialog');
    if (dialog instanceof KbSettingsDialog) dialog.show(section);
  }

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

  private async handleCreate(
    event: CustomEvent<{ password: string; withPasskey: boolean }>,
  ): Promise<void> {
    this.busy = true;
    await createNewVault(event.detail.password, event.detail.withPasskey);
  }

  private async handlePasskeyUnlock(): Promise<void> {
    this.busy = true;
    await unlockWithPasskey();
    this.busy = false;
  }

  private async handleUnlock(event: CustomEvent<{ password: string }>): Promise<void> {
    this.busy = true;
    await unlock(event.detail.password);
    this.busy = false;
  }

  private async handleJoin(
    event: CustomEvent<{ password: string; settings: SyncSettings }>,
  ): Promise<void> {
    this.busy = true;
    await joinExistingVault(event.detail.settings, event.detail.password);
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
        @note-create-titled=${(event: CustomEvent<{ title: string }>) => {
          const id = addNote(event.detail.title);
          if (id !== undefined) globalThis.location.hash = `#/note/${id}`;
        }}
        @note-open=${(event: CustomEvent<{ id: string }>) => {
          globalThis.location.hash = `#/note/${event.detail.id}`;
        }}
        @query-change=${(event: CustomEvent<{ query: string }>) => queryStore.set(event.detail.query)}
        @tag-toggle=${(event: CustomEvent<{ tag: string }>) =>
          tagFilterStore.update((current) => (current === event.detail.tag ? undefined : event.detail.tag))}
        @sync-save=${this.handleSyncSave}
        @passkey-enroll=${(event: CustomEvent<{ password: string }>) =>
          void enrollPasskeyForVault(event.detail.password)}
      >
        <kb-sidebar
          .index=${index}
          .selectedId=${selected ?? ''}
          .query=${queryStore.get()}
          .tagFilter=${tagFilterStore.get() ?? ''}
          .syncStatus=${status}
          .syncConfigured=${settings !== undefined && settings.url !== ''}
          .saveState=${saveStateStore.get()}
          .showHotkeys=${getCondition(CONDITIONS.showHotkeys)}
        ></kb-sidebar>
        <main>
          <kb-editor .noteId=${selected ?? ''} .doc=${doc} .index=${index}></kb-editor>
        </main>
        <kb-sync-dialog
          .settings=${settings}
          .autoLockMinutes=${Math.round(autoLockMs() / 60000)}
          .passkeySupported=${passkeySupportedStore.get()}
          .passkeyEnabled=${passkeyEnabledStore.get()}
          .notice=${settingsNoticeStore.get() ?? ''}
        ></kb-sync-dialog>
        <kb-settings-dialog></kb-settings-dialog>
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
          .error=${unlockErrorStore.get() ?? ''}
          .passkeySupported=${passkeySupportedStore.get()}
          @vault-create=${this.handleCreate}
          @vault-join=${this.handleJoin}
        ></kb-lock-screen>`;
      case 'locked':
        return html`<kb-lock-screen
          mode="unlock"
          ?busy=${this.busy}
          .error=${unlockErrorStore.get() ?? ''}
          .passkeySupported=${passkeySupportedStore.get()}
          .passkeyEnabled=${passkeyEnabledStore.get()}
          @vault-unlock=${this.handleUnlock}
          @vault-unlock-passkey=${this.handlePasskeyUnlock}
        ></kb-lock-screen>`;
      case 'unlocked':
        return this.renderWorkspace(indexStore.get(), selectedNoteStore.get());
    }
  }
}

customElements.define('kb-app', KbApp);
