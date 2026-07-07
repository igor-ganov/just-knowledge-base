# Requirements — Commands, Conditions, Hotkeys, Settings

## Overview

Every user-triggerable action in the app is a **Command** — no UI element may
perform an action except by executing a registered command. Commands are gated
by **Conditions** (named boolean app states, uniformly owned and subscribable),
and optionally bound to **Hotkeys** (a first-class, user-remappable
abstraction). A **show-hotkeys** mode overlays key chips on actionable controls.
Settings (including hotkey overrides) persist per user.

## User stories

### US-C1 — Commands
- **AC-C1.1** THE SYSTEM SHALL represent every user action as a command with: id, human title, context name, condition list, and optional default hotkey.
- **AC-C1.2** WHEN a command is executed (by click, hotkey, or programmatically) THE SYSTEM SHALL run it only if every condition currently holds; otherwise the execution is a no-op.
- **AC-C1.3** THE SYSTEM SHALL expose the full command registry (for the hotkey settings UI and the overlay).

### US-C2 — Conditions
- **AC-C2.1** THE SYSTEM SHALL manage named boolean conditions in a single registry; any code can read a condition or subscribe to its changes.
- **AC-C2.2** WHEN a condition changes THE SYSTEM SHALL notify subscribers synchronously (UI chips, hotkey dispatcher).

### US-C3 — Hotkeys
- **AC-C3.1** THE SYSTEM SHALL dispatch a keydown to at most one command: the one whose (user-overridden or default) hotkey matches AND whose conditions all hold.
- **AC-C3.2** THE SYSTEM SHALL let the user rebind any command's hotkey in settings; overrides persist per user and survive reload.
- **AC-C3.3** Hotkeys SHALL NOT fire while typing in text inputs/editors, except commands explicitly marked as global (e.g. lock, settings, show-hotkeys).

### US-C4 — Show-hotkeys overlay
- **AC-C4.1** WHEN the user activates "show hotkeys" (button or its own hotkey) THE SYSTEM SHALL display, over every visible actionable control whose command conditions hold, the key chip of that command — replacing/covering the control's label.
- **AC-C4.2** WHILE the overlay is active THE SYSTEM SHALL show chips only for commands whose conditions hold (exactly the set that would fire).
- **AC-C4.3** WHEN the user deactivates the mode (same trigger or Escape) THE SYSTEM SHALL restore normal labels.

### US-C5 — Settings
- **AC-C5.1** WHEN the user presses Ctrl+, (default, itself remappable) THE SYSTEM SHALL open the app settings dialog.
- **AC-C5.2** The settings dialog SHALL contain a hotkeys section (openable by its own command/hotkey) listing every command with context, current binding, and inline rebinding.
- **AC-C5.3** Settings SHALL be stored per user identity (git/GitHub login once connected; a local fallback identity before that) and reload with that user.

## Traceability
Tests name ACs; the registry and dispatcher are pure modules under unit test;
overlay and settings dialog under E2E.
