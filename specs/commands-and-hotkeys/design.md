# Design — Commands, Conditions, Hotkeys, Settings

## Modules (all pure TS, framework-free except the Lit directive)

- `src/core/conditions/conditions.ts` — registry of named `Store<boolean>`
  (reuses the app `Store` primitive). API: `defineCondition(key, initial)`,
  `setCondition(key, v)`, `getCondition(key)`, `subscribeCondition(key, fn)`,
  `allHold(keys)` and `subscribeAll(keys, fn)`.
- `src/core/commands/commandRegistry.ts` — `registerCommand(cmd)`,
  `executeCommand(id)` (checks `allHold(cmd.conditions)` — AC-C1.2),
  `commandsStore` (reactive list). `Command = { id, title, context,
  conditions, defaultHotkey?, global?, run }`.
- `src/core/commands/hotkeys.ts` — chord model `{ctrl, alt, shift, key}`;
  `parseChord('Ctrl+,')`, `chordOf(KeyboardEvent)`, `formatChord` (⌃⇧K-style
  chips); `bindingFor(commandId)` = user override ?? default;
  `dispatchKeydown(event)`: editable-target guard (AC-C3.3), unique match →
  `executeCommand`. Overrides live in a `Store<Record<commandId, chord|null>>`
  hydrated from settings.
- `src/features/settings/settingsService.ts` — `UserSettings = { hotkeyOverrides,
  autoLockMinutes, ... }` persisted to `localStorage` under
  `jkb-settings:<userId>`; `currentUserStore` starts `'local'`, switches after
  git identity connects (spec github-identity), settings re-hydrate on switch.
  (localStorage, not the vault: settings must load before unlock — the lock
  screen itself has commands.)
- `src/features/settings/kb-settings-dialog.ts` — sections General (auto-lock,
  sync moved here later) and Hotkeys: table of commands grouped by context,
  chip + "press new keys" inline capture, reset. Open via commands
  `settings.open` (Ctrl+,) and `settings.hotkeys` (Ctrl+Alt+,).
- Overlay: condition `mode.showHotkeys`; command `app.showHotkeys` (Ctrl+/)
  toggles it. Components render actionable controls through a small helper
  `hotkeyChip(commandId)` (Lit template fn) that subscribes to the mode +
  command conditions and swaps the label for the chip (AC-C4.1/4.2) — this
  works across shadow roots because each component renders its own chip; no
  global DOM walking.

## Wiring

Existing ad-hoc actions (new note, lock, sync, focus search, open settings,
toggle file panel, delete note, toggle editor mode) are re-registered as
commands in `src/features/app/commands.ts`; kb-app's keydown listener is
replaced by the dispatcher. Conditions initially defined: `vault.unlocked`,
`vault.locked`, `note.selected`, `sync.configured`, `sync.idle`,
`mode.showHotkeys`, `panel.filesOpen`.

## Rejected
- DOM-walking overlay (breaks across shadow roots) → per-component chips.
- Persisting settings in the vault (unavailable before unlock; per-user
  encrypted settings can sync later via the private space instead).
