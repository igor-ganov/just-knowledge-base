# Requirements — Folders & Shell Redesign

## Overview

Notes organize into folders (a tree). The workspace gets a modern shell: the
file panel (folder tree + notes) slides in from the left and is summoned by a
floating button; primary actions are floating buttons; the old static two-pane
layout goes away.

## User stories

### US-F1 — Folders
- **AC-F1.1** WHEN the user creates a folder (command `folder.new`, from the file panel) THE SYSTEM SHALL persist it in the vault and show it in the tree, including when empty.
- **AC-F1.2** WHEN the user creates a note inside a folder THE SYSTEM SHALL place it there; notes without a folder live at the root.
- **AC-F1.3** WHEN the user moves a note to another folder THE SYSTEM SHALL update the tree; wiki-links keep working (links are id-based).
- **AC-F1.4** WHEN the user deletes a folder THE SYSTEM SHALL keep its notes (they move to the root) — folders are organization, not containers of life and death.
- **AC-F1.5** Folder structure SHALL sync via the same CRDT catalog and converge (concurrent folder creations/moves merge without loss).

### US-F2 — Shell
- **AC-F2.1** THE SYSTEM SHALL show a floating panel-toggle button; activating it (or `Ctrl+B`) slides the file panel in from the left over the editor.
- **AC-F2.2** The file panel SHALL contain: search, folder tree with notes, tags, sync/save status, settings access.
- **AC-F2.3** WHEN the user picks a note or presses Escape THE SYSTEM SHALL close the panel on narrow screens; on wide screens the panel MAY stay pinned.
- **AC-F2.4** A floating "new note" action button SHALL always be available while unlocked.
- **AC-F2.5** All controls stay keyboard-operable and labelled (NFR-3 carries over).
