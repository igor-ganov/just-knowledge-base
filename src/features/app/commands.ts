import { registerCommand } from '@core/commands/commandRegistry';
import { defineCondition, getCondition, setCondition } from '@core/conditions/conditions';
import {
  lock,
  phaseStore,
  selectedNoteStore,
  syncNow,
  syncSettingsStore,
  syncStatusStore,
} from './appController';

/**
 * All app conditions and commands (spec commands-and-hotkeys). Every user
 * action goes through here — components only ever `executeCommand`.
 */
export const CONDITIONS = {
  unlocked: 'vault.unlocked',
  locked: 'vault.locked',
  noteSelected: 'note.selected',
  syncConfigured: 'sync.configured',
  syncIdle: 'sync.idle',
  showHotkeys: 'mode.showHotkeys',
  filesOpen: 'panel.filesOpen',
  narrow: 'viewport.narrow',
} as const;

export type AppUi = {
  readonly focusSearch: () => void;
  readonly newNote: () => void;
  readonly newFolder: () => void;
  readonly deleteCurrentNote: () => void;
  readonly openAppSettings: (section?: 'general' | 'hotkeys') => void;
  readonly openSyncSettings: () => void;
  readonly toggleFilesPanel: () => void;
  readonly unlockWithPasskey: () => void;
};

export const bindConditionSources = (): void => {
  defineCondition(CONDITIONS.unlocked, false);
  defineCondition(CONDITIONS.locked, false);
  defineCondition(CONDITIONS.noteSelected, false);
  defineCondition(CONDITIONS.syncConfigured, false);
  defineCondition(CONDITIONS.syncIdle, true);
  defineCondition(CONDITIONS.showHotkeys, false);
  const narrowQuery = globalThis.matchMedia?.('(max-width: 64rem)');
  defineCondition(CONDITIONS.narrow, narrowQuery?.matches ?? false);
  defineCondition(CONDITIONS.filesOpen, !(narrowQuery?.matches ?? false));
  narrowQuery?.addEventListener('change', (event) => setCondition(CONDITIONS.narrow, event.matches));

  phaseStore.subscribe((phase) => {
    setCondition(CONDITIONS.unlocked, phase === 'unlocked');
    setCondition(CONDITIONS.locked, phase === 'locked' || phase === 'no-vault');
  });
  selectedNoteStore.subscribe((selected) => setCondition(CONDITIONS.noteSelected, selected !== undefined));
  syncSettingsStore.subscribe((settings) =>
    setCondition(CONDITIONS.syncConfigured, settings !== undefined && settings.url !== ''),
  );
  syncStatusStore.subscribe((status) => setCondition(CONDITIONS.syncIdle, status.state !== 'syncing'));
};

export const registerAppCommands = (ui: AppUi): void => {
  registerCommand({
    id: 'note.new',
    title: 'New note',
    context: 'notes',
    conditions: [CONDITIONS.unlocked],
    defaultHotkey: 'Ctrl+n',
    run: ui.newNote,
  });
  registerCommand({
    id: 'note.delete',
    title: 'Delete note',
    context: 'notes',
    conditions: [CONDITIONS.unlocked, CONDITIONS.noteSelected],
    run: ui.deleteCurrentNote,
  });
  registerCommand({
    id: 'search.focus',
    title: 'Search notes',
    context: 'navigation',
    conditions: [CONDITIONS.unlocked],
    defaultHotkey: 'Ctrl+k',
    run: ui.focusSearch,
  });
  registerCommand({
    id: 'panel.files',
    title: 'Toggle file panel',
    context: 'navigation',
    conditions: [CONDITIONS.unlocked],
    defaultHotkey: 'Ctrl+b',
    run: ui.toggleFilesPanel,
  });
  registerCommand({
    id: 'vault.lock',
    title: 'Lock vault',
    context: 'vault',
    conditions: [CONDITIONS.unlocked],
    defaultHotkey: 'Ctrl+l',
    global: true,
    run: () => void lock(),
  });
  registerCommand({
    id: 'vault.unlockPasskey',
    title: 'Unlock with passkey',
    context: 'vault',
    conditions: [CONDITIONS.locked],
    run: ui.unlockWithPasskey,
  });
  registerCommand({
    id: 'sync.now',
    title: 'Sync now',
    context: 'sync',
    conditions: [CONDITIONS.unlocked, CONDITIONS.syncConfigured, CONDITIONS.syncIdle],
    defaultHotkey: 'Ctrl+Shift+s',
    run: () => void syncNow(),
  });
  registerCommand({
    id: 'sync.settings',
    title: 'Sync settings',
    context: 'sync',
    conditions: [CONDITIONS.unlocked],
    run: ui.openSyncSettings,
  });
  registerCommand({
    id: 'settings.open',
    title: 'Open settings',
    context: 'app',
    conditions: [],
    defaultHotkey: 'Ctrl+,',
    global: true,
    run: () => ui.openAppSettings('general'),
  });
  registerCommand({
    id: 'settings.hotkeys',
    title: 'Hotkey settings',
    context: 'app',
    conditions: [],
    defaultHotkey: 'Ctrl+Alt+,',
    global: true,
    run: () => ui.openAppSettings('hotkeys'),
  });
  registerCommand({
    id: 'app.showHotkeys',
    title: 'Show hotkeys',
    context: 'app',
    conditions: [],
    defaultHotkey: 'Ctrl+/',
    global: true,
    run: () => setCondition(CONDITIONS.showHotkeys, !getCondition(CONDITIONS.showHotkeys)),
  });
  registerCommand({
    id: 'app.hideHotkeys',
    title: 'Hide hotkeys',
    context: 'app',
    conditions: [CONDITIONS.showHotkeys],
    defaultHotkey: 'Escape',
    global: true,
    run: () => setCondition(CONDITIONS.showHotkeys, false),
  });
  // Registered after hideHotkeys on purpose: Escape resolves to the first
  // enabled match, so chips close before the panel does.
  registerCommand({
    id: 'panel.close',
    title: 'Close file panel',
    context: 'navigation',
    conditions: [CONDITIONS.filesOpen, CONDITIONS.narrow],
    defaultHotkey: 'Escape',
    run: () => setCondition(CONDITIONS.filesOpen, false),
  });
  registerCommand({
    id: 'folder.new',
    title: 'New folder',
    context: 'notes',
    conditions: [CONDITIONS.unlocked],
    run: ui.newFolder,
  });
};
