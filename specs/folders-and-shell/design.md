# Design — Folders & Shell Redesign

## Folders in the catalog CRDT

The catalog doc gains two structures (same Y.Doc, syncs with the existing
pipeline — AC-F1.5):

- `folders: Y.Map<folderId, { name, parentId?, deleted }>` — LWW per folder;
  ids are UUIDs so concurrent creations never collide; `deleted` is a
  tombstone (empty folders are real records — AC-F1.1).
- note placement: `notePlacement: Y.Map<noteId, folderId | ''>` — LWW; missing
  or '' = root (AC-F1.2). Kept separate from the note-status map so a move
  never races a delete entry.

Pure module `src/core/crdt/folders.ts`: `createFolder`, `renameFolder`,
`deleteFolder` (re-roots children and notes at read time — AC-F1.4),
`moveNote`, `folderTree(catalog, notes)` → tree projection
`{ id, name, folders[], notes[] }` with orphans (deleted/missing parents)
folding into the root deterministically.

## Shell

- `kb-app` drops the grid: full-bleed `<main>` (editor) + `kb-file-panel`
  (renamed sidebar) as an overlay `position: fixed; left: 0` with
  transform-based slide; condition `panel.filesOpen` drives it (already a
  command, Ctrl+B).
- Floating buttons (`kb-fab` styles, top-left): panel toggle ☰; bottom-right:
  ➕ new note. Both run commands and show hotkey chips in show-hotkeys mode.
- Wide screens (≥ 64rem): panel pins (pushes content) instead of overlaying;
  narrow: overlay + close on note pick / Escape (AC-F2.3).
- Tree UI in the panel: folders collapsible (`<details>`), per-folder “+ note”,
  note rows with move menu (`<select>` of folders) — minimal, keyboard-friendly.

## Rejected
- Filesystem-path folders (rename = touching every note; racy across devices) →
  id-keyed folder records with a placement map.
- Drag-and-drop as the only move mechanism (inaccessible) → explicit move
  control; DnD can come later.
