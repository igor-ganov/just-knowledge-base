# Design — Knowledge Base MVP (Web/PWA)

Satisfies: `requirements.md` (AC references inline). Each section names the ACs it realizes.

---

## 1. System overview

```
┌───────────────────────────── Browser (PWA) ─────────────────────────────┐
│  UI (Lit components, feature-based)                                     │
│    lock-screen · note-list · editor · backlinks · tags · search · sync  │
│                              │                                          │
│  Application services (Effect-TS layers)                                │
│    VaultSession · NoteService · IndexService · SyncService              │
│                              │                                          │
│  Domain (pure functions, unit-tested)                                   │
│    crypto envelope · CRDT merge rules · link/tag parsing · repo layout  │
│                              │                                          │
│  Ports (interfaces)          │            Web adapters (MVP)            │
│    StoragePort ──────────────┼──────────  OPFS / LightningFS            │
│    GitTransportPort ─────────┼──────────  isomorphic-git + CORS proxy   │
│    KdfPort ──────────────────┼──────────  hash-wasm Argon2id            │
│    AeadPort ─────────────────┼──────────  WebCrypto AES-256-GCM         │
└──────────────────────────────────────────────────────────────────────────┘
                     Tauri shells (future specs) swap adapters:
                     native FS · native git (gitoxide/libgit2) · OS keystore
```

The ports row is the load-bearing wall for **NFR-4**: business logic and UI never
import an adapter directly; Effect-TS `Layer`s wire adapters per platform.

**Single storage principle:** the vault *is* a local git repository. There is no
separate app database; the working tree (encrypted blobs) plus `.git` history is
the one source of truth. Sync = fetch/merge/push of that repository (US-7), and a
vault with no remote is simply a repo with no remote configured (AC-7.6).

---

## 2. Technology choices and rejected alternatives

### 2.1 CRDT engine: **Yjs** (satisfies US-8)

Per-note `Y.Doc` with a `Y.Text` body; a vault-level catalog doc (§4.2) for
note metadata. Persisted as **append-only binary update blobs**.

Why Yjs:
- `Y.mergeUpdates([...])` is commutative, associative, idempotent — the union of
  any set of update blobs from any devices yields one deterministic state
  (AC-8.5). This makes git merging trivial (§5.3).
- Character-level text merging (YATA) satisfies AC-8.2 directly.
- Pure JS, ~50 KB, a decade of production use; no WASM in the critical unlock path.

Rejected:
- **Automerge 2.x** — equally correct semantics and great local-first pedigree, but
  ~0.8 MB WASM, slower text merges at scale, and its whole-doc save format is less
  natural for the append-only-blob git layout than Yjs update concatenation.
- **Loro** — promising performance but too young for a data-integrity-critical vault.
- **OT (ShareDB-style)** — requires a central sequencing server; contradicts
  local-first and "any dumb git remote" (US-7).
- **Plaintext Markdown files + custom git merge driver** — line-level three-way
  merges lose concurrent same-line edits (violates AC-8.2) and filenames/diffs leak
  content (violates AC-7.3).

### 2.2 Git implementation: **isomorphic-git** over StoragePort FS (US-7)

- Runs entirely in the browser; talks smart-HTTP to any remote (AC-7.1).
- **CORS constraint:** github.com/gitlab.com do not serve CORS headers for git
  smart-HTTP, so the web build routes remote calls through a self-hosted ~30-line
  Cloudflare Worker CORS proxy (same host pattern as our other projects). The proxy
  relays ciphertext only — AC-7.3/7.4 hold even against the proxy operator. The
  proxy URL is user-configurable; Tauri shells will use a native-git adapter and no
  proxy at all.
- FS backend: OPFS where available, else LightningFS (IndexedDB) — both behind
  StoragePort (AC-6.1).

Rejected:
- **wasm-git (libgit2)** — heavyweight WASM, awkward async FS bridging.
- **Custom sync protocol over Workers** — rejected by product decision (any git
  remote, no bespoke server).

### 2.3 Cryptography (US-1, US-7, NFR-1)

- **KDF:** Argon2id via `hash-wasm` (WebCrypto has no Argon2). Parameters: 19 MiB
  memory, t=2, p=1 — the current OWASP recommendation for interactive logins;
  stored in the public manifest so they can be raised later per-vault. (64 MiB/t=3
  was tried and blew the NFR-2 unlock budget in-browser.)
- **AEAD:** AES-256-GCM via WebCrypto with a **non-extractable** `CryptoKey` — the
  browser never exposes raw key bytes to JS after derivation (AC-1.4, AC-9.2).
  96-bit random nonces; at MVP write volumes (≪ 2³² records) random nonces are safe.
- **Key hierarchy:** master password → Argon2id(salt) → **KEK**; random 256-bit
  **DEK** generated at vault creation, wrapped by KEK, stored in the manifest.
  Password change = re-wrap DEK only, no data re-encryption. Wrong password fails
  DEK unwrap (GCM auth) — one uniform error, AC-1.3.
- **Envelope:** every stored record is `nonce ‖ ciphertext ‖ tag` with AAD =
  `(vault-format-version, record-path)` — binds a blob to its location, preventing
  ciphertext swap/replay inside the repo (supports AC-6.5).

Rejected: libsodium XChaCha20-Poly1305 (extra 300 KB WASM and extractable keys in
JS memory; WebCrypto's non-extractable GCM keys are the better browser fit);
PBKDF2 (not memory-hard); password-encrypts-data-directly (no cheap password change).

### 2.4 Search: **MiniSearch**, in-memory (US-5)

Index built at unlock from decrypted notes, updated incrementally on edit; lives
only in RAM and dies at lock (AC-5.2, AC-9.2). ~1,000 × 2 KB notes indexes in
well under a second and queries in single-digit ms (AC-5.4). Rejected: FlexSearch
(weaker typings/maintenance), SQLite-WASM FTS (an entire DB engine for an
in-memory index we can rebuild on unlock).

### 2.5 UI shell: Astro static site + Lit + Effect-TS (stack convention)

Astro emits the static shell; all interactivity is Lit custom elements arranged
feature-based (`features/<feature>/{components,logic,services}`), per
`functional-frontend` and `angular-style`-equivalent Lit rules. Service worker
(generated, e.g. Workbox) precaches the app shell only — **never vault data or
plaintext** (AC-6.3, AC-6.4, AC-9.3).

---

## 3. Data model

### 3.1 Note (domain)

```ts
type NoteId = string;            // UUIDv4, stable across renames — AC-3.5
type Note = {
  readonly id: NoteId;
  readonly title: string;        // lives inside the CRDT doc, encrypted at rest
  readonly body: string;         // Y.Text projection
  readonly updatedAt: number;    // Lamport-ish logical stamp, not wall clock
};
type NoteIndexEntry = {
  readonly links: ReadonlyArray<NoteId>;   // parsed [[wiki-links]] — US-3
  readonly tags: ReadonlyArray<string>;    // parsed #tags — US-4
};
```

Wiki-links serialize as `[[note-id|Title at link time]]` in the stored text; the
editor displays/edits the human form and the parser resolves by id (AC-3.5).
Autocomplete (AC-3.3) searches the title index and inserts the id form.

### 3.2 Catalog document (vault-level Y.Doc)

A `Y.Map<NoteId, CatalogEntry>` where `CatalogEntry = { deleted: boolean, tombstoneSvB64?: string }`.

- Delete sets `deleted: true` and snapshots the note doc's **state vector** into
  the tombstone (AC-2.4).
- **Edit-wins-over-delete (AC-8.3):** after any merge, if the merged note doc
  contains structs the tombstone's state vector has not seen, a concurrent-or-
  later edit occurred and the note projects as active. Pure function
  `isNoteDeleted(entry, doc)`, unit-tested (NFR-6).
- *Rationale for the revision:* clock counters inside LWW map values (the first
  design) can be discarded by Yjs's last-writer-wins conflict resolution, losing
  the concurrent editor's clock. State vectors live in the note doc itself,
  which merges losslessly, so the rule is deterministic on every device.
  Character-deletion-only edits do not bump state vectors and do not resurrect
  (documented behavior).

---

## 4. Vault-on-git repository layout (US-6, US-7)

```
vault.json                     # PUBLIC manifest: {formatVersion, kdf: {algo, salt,
                               #   params}, wrappedDek, createdAt}
catalog/<blobhash>.bin         # encrypted Yjs update blobs of the catalog doc
notes/<noteId>/<blobhash>.bin  # encrypted Yjs update blobs, append-only per note
```

- `noteId` is a UUID — reveals nothing (AC-7.3). Titles, tags, links, and content
  exist only inside encrypted blobs. `blobhash` = SHA-256 of ciphertext (content-
  addressed, so identical blobs dedupe and re-push is idempotent).
- **Append-only:** an edit session flushes one new update blob; existing files are
  never modified. Git add/add on *different* filenames cannot conflict.
- **Compaction:** when a note's blob count exceeds a threshold (e.g. 20), write one
  merged snapshot blob and delete the old ones in the same commit. Concurrent
  compactions on two devices are safe: both snapshots merge via `Y.mergeUpdates`
  like any other blobs; a later compaction absorbs both.

---

## 5. Sync algorithm (US-7, US-8)

```
sync():                                             # SyncService, Effect pipeline
  1. flush pending CRDT updates → new encrypted blobs → git commit (local)
  2. fetch remote                                   # AC-7.2
  3. if remote head == local head → push? → done
  4. else UNION-MERGE (no isomorphic-git merge machinery):
       tree = union of file sets from both heads
       (deletions from compaction honored via each side's commit ancestry)
       vault.json: identical by construction after vault creation; if versions
       differ, higher formatVersion wins (deterministic)
       create merge commit with both parents            # AC-8.4 — cannot conflict
  5. reload catalog + open notes from merged blob set (Y.mergeUpdates)
       apply resolveCatalog (edit-wins-over-delete)     # AC-8.3
  6. push; on non-fast-forward (raced by another device) → retry from 2 (max 3)
  7. any failure at any step: local repo untouched beyond local commits,
       error surfaced, retry available                  # AC-7.5
```

Because merging is a *union of content-addressed encrypted files* with CRDT
semantics inside, git-level conflicts are impossible by construction — this is the
design answer to AC-8.4, not a hope that merges go well.

Credentials (PAT tokens) are stored AEAD-encrypted inside the vault, keyed by the
DEK (AC-7.1); the CORS proxy URL is non-secret config.

---

## 6. Session & key lifecycle (US-1, US-9)

State machine: `NoVault → Creating → Locked ⇄ Unlocked → Locked (manual | idle 15 min | tab hidden > interval)`.

- Unlock: read manifest → Argon2id → unwrap DEK as non-extractable CryptoKey →
  decrypt catalog → decrypt notes lazily on open; build search index.
- Lock: drop the Effect layer holding the CryptoKey and all decrypted state; Lit
  stores reset; SW caches never held plaintext (AC-9.2, AC-9.3). Idle timer is an
  Effect fiber reset by user activity events (AC-9.1).
- No recovery path: stated on the create screen (AC-1.6).

---

## 7. UI / interaction design (NFR-3)

- **Layout:** two-pane workspace — left sidebar (search field on top, note list,
  tag list with counts), main pane (editor with rendered-Markdown preview toggle,
  backlinks panel at the bottom). Lock screen is a single centered form.
- **Editor:** CodeMirror 6 bound to Y.Text via y-codemirror.next (proven pairing;
  gives decorations for wiki-links/tags and the `[[` autocomplete tooltip).
- **Keyboard:** `Ctrl+K` search, `Ctrl+N` new note, `Ctrl+L` lock; full tab-order,
  visible focus rings, ARIA: `navigation` (sidebar), `main` (editor),
  `search` (search box), `role=listbox` for autocomplete (AC-3.3, NFR-3).
- **Design tokens:** CSS custom properties, light/dark via `prefers-color-scheme`;
  AA contrast verified in E2E via axe check.
- **Sync UI:** single status control in the sidebar footer — hidden state machine
  `idle/syncing/ok/error(cause)` (AC-7.2, AC-7.5); settings dialog for remote
  URL/token/proxy (AC-7.1) and auto-lock interval (AC-9.1).

---

## 8. Testing strategy (NFR-6)

| Layer | Tool | Covers |
|---|---|---|
| Pure domain (crypto envelope, catalog merge rules, link/tag parser, repo layout) | `bun test` unit + fast-check property tests | AC-1.3/1.4, AC-3.5, AC-4.1, AC-8.3, AC-8.5 (random op interleavings) |
| Services with in-memory adapters | `bun test` integration (in-memory StoragePort + local bare repo as GitTransportPort) | AC-2.x, AC-7.2/7.5, sync retry loop |
| Full flows | Playwright E2E, event-driven waits only | AC-1.x, AC-2.x, AC-3.1–3.4, AC-5.x, AC-6.2–6.4, AC-7.6, AC-9.1; two-context tests for AC-8.1/8.2 (two browser contexts, one bare remote via local git http server) |

TDD order per task: failing E2E (or unit for pure logic) first — see `tasks.md`.

---

## 9. Risks

- **OPFS/isomorphic-git FS coupling** — isomorphic-git wants a callback FS;
  OPFS adapter needs care (sync access handles only in workers). Mitigation:
  StoragePort abstracts it; LightningFS fallback is known-good with isomorphic-git.
- **Argon2 64 MiB on low-end mobile browsers** — unlock time bounded by NFR-2;
  parameters are per-vault manifest data, tunable at creation.
- **Yjs tombstone growth** — bounded by compaction (§4).
- **CORS proxy availability** — self-hosted, stateless, trivially redeployable;
  sees ciphertext only.
