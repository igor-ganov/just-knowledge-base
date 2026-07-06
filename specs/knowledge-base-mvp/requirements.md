# Requirements — Knowledge Base MVP (Web/PWA)

## Overview

`just-knowledge-base` is a local-first, end-to-end-encrypted personal knowledge base.
Notes are Markdown documents with wiki-links, tags, and full-text search. All data
lives on the user's device; an optional sync pushes the vault — already encrypted —
to any git remote the user configures. Concurrent edits from multiple devices
converge automatically via CRDT (Conflict-free Replicated Data Types); the user is
never shown a git merge conflict.

The MVP targets the web platform as an installable, offline-capable PWA. Desktop
and mobile builds (Tauri v2 wrappers around the same web app) are future specs;
this spec's architecture must not preclude them (see NFR-4).

**Stack (fixed by project convention):** Astro + Lit + Effect-TS + TypeScript,
bun runtime, Playwright for E2E, Cloudflare for hosting the static site.

### Glossary

- **Vault** — the entire encrypted data set: notes, metadata, CRDT history, settings.
- **Master password** — the only secret the user memorizes; never stored, never transmitted.
- **Vault key** — symmetric key derived from the master password; encrypts all content.
- **Remote** — a user-supplied git repository URL + credential used for sync.
- **Wiki-link** — an inline `[[Note Title]]` reference from one note to another.

### Out of scope for this spec

- Tauri desktop and mobile wrappers (separate specs: `desktop-shell`, `mobile-shell`).
- Rich-text/WYSIWYG editing, attachments/images, note history UI.
- Multi-user sharing, per-note permissions.
- Own sync server; MVP talks to generic git remotes only.

---

## User stories

### US-1 — Vault lifecycle

> As a user, I want to create a vault protected by a passkey — falling back to a
> master password — and unlock it on later visits, so that only I can read my
> notes without typing a password every time.

Acceptance criteria:

- **AC-1.0** WHERE the platform supports WebAuthn with the PRF extension THE SYSTEM SHALL offer passkey unlock as the primary method; the master password SHALL always exist as the fallback protector, and both SHALL decrypt the same vault key.
- **AC-1.0a** WHEN the user unlocks with a passkey THE SYSTEM SHALL NOT require the password; IF the passkey ceremony fails or is cancelled THEN THE SYSTEM SHALL leave the vault locked and keep the password form available.
- **AC-1.0b** IF the platform lacks WebAuthn/PRF support THEN THE SYSTEM SHALL operate password-only with no degradation of other capabilities.
- **AC-1.0c** WHEN a vault has no passkey enrolled THE SYSTEM SHALL allow enrolling one later from settings, given the master password.

- **AC-1.1** WHEN a first-time user submits a master password (and confirmation) THE SYSTEM SHALL create an empty vault encrypted with a key derived from that password via a memory-hard KDF (Argon2id) and open the workspace.
- **AC-1.2** WHEN a returning user submits the correct master password THE SYSTEM SHALL unlock the vault and open the workspace.
- **AC-1.3** IF the submitted password is wrong THEN THE SYSTEM SHALL show an error, SHALL NOT reveal whether the vault contains data, and SHALL remain locked.
- **AC-1.4** WHILE the vault is locked THE SYSTEM SHALL NOT hold any plaintext note content or the vault key in memory, and SHALL NOT persist either to storage at any time.
- **AC-1.5** WHEN the user locks the vault explicitly THE SYSTEM SHALL discard the vault key and return to the lock screen.
- **AC-1.6** IF the user loses the master password THEN THE SYSTEM SHALL have no recovery path (documented in UI copy at vault creation).

### US-2 — Note authoring

> As a user, I want to create, edit, and delete Markdown notes, so that I can
> capture knowledge.

Acceptance criteria:

- **AC-2.1** WHEN the user creates a note with a title THE SYSTEM SHALL persist it encrypted to device storage and show it in the note list.
- **AC-2.2** WHEN the user edits note content THE SYSTEM SHALL autosave the change (encrypted) without an explicit save action.
- **AC-2.3** WHEN the user views a note THE SYSTEM SHALL render its Markdown (headings, emphasis, lists, code blocks, links) alongside or in place of the editable source.
- **AC-2.4** WHEN the user deletes a note THE SYSTEM SHALL remove it from the list and record the deletion so that sync propagates it (tombstone).
- **AC-2.5** WHEN the user reloads the app and unlocks THE SYSTEM SHALL show all previously saved notes unchanged.

### US-3 — Wiki-links and backlinks

> As a user, I want to link notes with `[[Title]]` syntax and see backlinks,
> so that my notes form a connected knowledge graph.

Acceptance criteria:

- **AC-3.1** WHEN note content contains `[[Existing Note]]` THE SYSTEM SHALL render it as a navigable link that opens that note.
- **AC-3.2** WHEN note content contains `[[Missing Note]]` referencing no existing note THE SYSTEM SHALL render it as a distinct "unresolved" link, and WHEN activated SHALL create a note with that title and open it.
- **AC-3.3** WHEN the user types `[[` in the editor THE SYSTEM SHALL offer autocomplete over existing note titles.
- **AC-3.4** WHEN the user views a note THE SYSTEM SHALL list all notes that link to it (backlinks).
- **AC-3.5** WHEN a linked note is renamed THE SYSTEM SHALL keep existing `[[links]]` resolving to it (links track note identity, not the title string).

### US-4 — Tags

> As a user, I want to tag notes and filter by tag, so that I can organize
> orthogonally to links.

Acceptance criteria:

- **AC-4.1** WHEN note content contains `#tag` tokens THE SYSTEM SHALL index them as that note's tags.
- **AC-4.2** WHEN the user selects a tag THE SYSTEM SHALL show the list of notes carrying it.
- **AC-4.3** THE SYSTEM SHALL show the set of all tags in use with per-tag note counts.

### US-5 — Full-text search

> As a user, I want to search across all notes instantly, so that I can find
> knowledge without remembering where I put it.

Acceptance criteria:

- **AC-5.1** WHEN the user types a query THE SYSTEM SHALL show matching notes (title and body matches) updating as the query changes.
- **AC-5.2** THE SYSTEM SHALL perform search entirely on-device against decrypted in-memory data; no query or content leaves the device.
- **AC-5.3** WHEN a search result is chosen THE SYSTEM SHALL open that note.
- **AC-5.4** WHERE the vault holds 1,000 notes of typical size (~2 KB) search results SHALL appear within 150 ms of a keystroke on a mid-range device.

### US-6 — Local-first persistence and offline operation

> As a user, I want the app to work fully offline with all data on my device,
> so that I own my data and never depend on connectivity.

Acceptance criteria:

- **AC-6.1** THE SYSTEM SHALL store all vault data on-device (OPFS or IndexedDB); no application server holds user data.
- **AC-6.2** WHILE the device is offline THE SYSTEM SHALL support every capability except sync (create, edit, delete, link, tag, search).
- **AC-6.3** WHEN the PWA has been visited once THE SYSTEM SHALL load and unlock while fully offline (service-worker-cached app shell).
- **AC-6.4** THE SYSTEM SHALL be installable as a PWA (valid manifest, icons, service worker).
- **AC-6.5** IF persisted data fails integrity checks on unlock THEN THE SYSTEM SHALL report which records are affected and continue with the intact remainder rather than failing the whole vault.

### US-7 — Encrypted sync via git remote

> As a user, I want to connect my vault to a git repository I control and sync
> on demand, so that I get backup and multi-device access without trusting a cloud
> provider with plaintext.

Acceptance criteria:

- **AC-7.1** WHEN the user supplies a git remote URL and credential (token) THE SYSTEM SHALL validate connectivity and store the credential encrypted inside the vault.
- **AC-7.2** WHEN the user triggers sync THE SYSTEM SHALL pull the remote, merge, commit, and push, reporting progress and outcome.
- **AC-7.3** THE SYSTEM SHALL write only ciphertext to the git repository: note content, titles, tags, link targets, and CRDT history SHALL all be encrypted; an observer of the remote SHALL learn at most vault-format version, object counts/sizes, and sync timestamps.
- **AC-7.4** THE SYSTEM SHALL NOT transmit the master password, vault key, or any plaintext to any network endpoint, ever.
- **AC-7.5** IF sync fails (network, auth, non-fast-forward) THEN THE SYSTEM SHALL leave local data intact and consistent, report the cause, and allow retry.
- **AC-7.6** WHILE no remote is configured THE SYSTEM SHALL function fully with sync UI absent or inert (sync is strictly optional).

### US-8 — CRDT convergence across devices

> As a user, I want edits from my different devices to merge automatically,
> so that I never resolve a git conflict by hand and never lose an edit.

Acceptance criteria:

- **AC-8.1** WHEN two devices edit *different* notes offline and both sync THE SYSTEM SHALL converge both vaults to contain both edits.
- **AC-8.2** WHEN two devices edit *the same note's text* offline and both sync THE SYSTEM SHALL merge at CRDT granularity, preserving both edits where they do not overlap character-wise; neither device's edit is silently dropped.
- **AC-8.3** WHEN one device deletes a note another has edited THE SYSTEM SHALL resolve deterministically (edit wins over delete) and both devices SHALL converge to the same state.
- **AC-8.4** THE SYSTEM SHALL never surface a git merge-conflict state to the user; convergence is automatic in all cases.
- **AC-8.5** WHEN the same vault syncs from N devices in any interleaving THE SYSTEM SHALL reach the same final state on all of them (confluence).

### US-9 — Session security

> As a user, I want the vault to lock itself when unattended, so that a walk-up
> attacker cannot read my notes.

Acceptance criteria:

- **AC-9.1** WHEN the vault has been unlocked and idle for a configurable interval (default 15 min) THE SYSTEM SHALL auto-lock.
- **AC-9.2** WHEN auto-lock or manual lock occurs THE SYSTEM SHALL discard the vault key and all plaintext from application state.
- **AC-9.3** WHERE the platform supports it THE SYSTEM SHALL keep unlocked content out of durable browser caches (no plaintext in service-worker caches, localStorage, or IndexedDB).

---

## Non-functional requirements

- **NFR-1 (Crypto baseline)** — Symmetric encryption SHALL be an AEAD (AES-256-GCM or XChaCha20-Poly1305) with per-record nonces; key derivation SHALL be Argon2id with parameters meeting current OWASP guidance; all primitives from audited implementations (WebCrypto / libsodium build), never hand-rolled.
- **NFR-2 (Performance)** — Cold start to lock screen ≤ 2 s; unlock (KDF included) ≤ 1.5 s; note open ≤ 100 ms at 1,000-note scale.
- **NFR-3 (Accessibility)** — Full keyboard operability, visible focus, WCAG 2.1 AA contrast, correct ARIA landmarks/roles; editor and search usable with a screen reader.
- **NFR-4 (Portability)** — All platform capabilities (storage, git transport, key handling) SHALL sit behind ports (interfaces) with web implementations, such that Tauri desktop/mobile shells can substitute native adapters without touching business logic.
- **NFR-5 (Code conventions)** — Functional TypeScript per project skills (`typescript-style`, `functional-frontend`): Effect-TS pipelines, no `any`/`as`/`null`, pure functions unit-tested, feature-based structure with explicit layers (ports/logic/services/helpers).
- **NFR-6 (Testing)** — Every AC above maps to at least one automated test: Playwright E2E for user-visible flows (event-driven waits, no timeouts, per `playwright-testing`), unit tests for pure logic (crypto envelope, CRDT merge, link/tag indexing). CRDT convergence (US-8) additionally covered by property-based tests over random operation interleavings.

---

## Traceability

Each AC id above is referenced by `design.md` sections and `tasks.md` items;
tests name the AC they verify in their titles (e.g. `AC-8.2 concurrent same-note edits merge`).
