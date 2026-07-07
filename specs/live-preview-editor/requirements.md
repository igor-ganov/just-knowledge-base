# Requirements — Live-Preview Editor

## Overview

One editing surface, Obsidian-style: the note renders as formatted text while
remaining fully editable. The markup of the element under the caret is revealed
inline — a "window into the source" that follows the cursor. The separate
edit/preview split is removed; a Source toggle shows the whole raw document.

## Acceptance criteria

- **AC-L1** THE SYSTEM SHALL render markdown (headings, bold/italic, inline code, code blocks, bullet lists, quotes, links) as formatted text directly in the editor; the document stays editable at every position.
- **AC-L2** WHILE the caret or selection touches an element THE SYSTEM SHALL reveal that element's raw markup; WHEN the caret leaves it THE SYSTEM SHALL hide the markup again.
- **AC-L3** Wiki-links render as navigable links: activating a resolved link opens the note; an unresolved link is visually distinct and creates the note (carries over AC-3.1/3.2).
- **AC-L4** Tags render highlighted (AC-4.1 carries over).
- **AC-L5** A Source toggle SHALL show the entire document as raw markdown and back.
- **AC-L6** Editing through the live surface SHALL keep CRDT autosave and sync behavior unchanged (AC-2.2/2.5 carry over — verified by the existing persistence tests running on the live editor).

## Supersedes

The `Preview` toggle and HTML preview pane of the MVP spec (US-2/AC-2.3 is
re-satisfied by AC-L1). The pure `renderMarkdown` module remains for future
read-only export/printing.
