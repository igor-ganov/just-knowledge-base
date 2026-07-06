# Tasks — Knowledge Base MVP (Web/PWA)

Ordered, one task at a time, tree stays green between tasks.
Format: `[ ] Tn — what (ACs) → verifying tests`.

## Phase A — Skeleton

- [x] T1 — Scaffold repo: Astro + Lit + TypeScript (strict) + bun, ESLint flat config, `bun test` + fast-check, Playwright config (event-driven waits), wrangler.jsonc for CF deploy, feature-based folder layout, CI-ready scripts in package.json. → smoke E2E: app shell renders.
- [x] T2 — Design tokens + base layout shell: sidebar/main two-pane, light/dark, ARIA landmarks (NFR-3). → E2E: landmarks present. (Automated axe audit deferred to a follow-up; manual contrast-checked tokens.)

## Phase B — Domain (pure, unit-tested first)

- [x] T3 — Crypto envelope: AEAD encrypt/decrypt with AAD binding (record path), envelope encode/decode (NFR-1, AC-6.5) → unit: roundtrip, tamper detection, wrong-AAD rejection.
- [x] T4 — Key hierarchy: Argon2id KDF (hash-wasm), DEK generate/wrap/unwrap via WebCrypto non-extractable keys (AC-1.1–1.4) → unit: derive→wrap→unwrap roundtrip; wrong password fails uniformly.
- [x] T5 — Note CRDT module: per-note Y.Doc (title + Y.Text body), update-blob flush/load via Y.mergeUpdates (AC-8.2, AC-8.5) → unit + property test: random interleavings converge.
- [x] T6 — Catalog CRDT + resolveCatalog edit-wins-over-delete (AC-2.4, AC-8.3) → unit + property tests.
- [x] T7 — Link/tag parser: `[[id|Title]]` wiki-links, `#tag` extraction, id-based resolution (AC-3.5, AC-4.1) → unit tests.

## Phase C — Storage & session

- [x] T8 — StoragePort + LightningFS adapter; vault-on-git repo layout read/write (manifest, content-addressed encrypted blobs) (AC-6.1, §4 design) → integration tests with in-memory FS.
- [x] T9 — VaultSession service: create/unlock/lock state machine, idle auto-lock fiber (AC-1.1–1.6, AC-9.1–9.3) → unit + E2E: create vault, reload, unlock, wrong password, auto-lock.
- [x] T10 — NoteService: CRUD over CRDT + storage, autosave debounce, tombstones (AC-2.1–2.5) → E2E: create/edit/delete/reload survive.

## Phase D — Knowledge features

- [x] T11 — Editor: CodeMirror 6 + y-codemirror binding, Markdown preview toggle (AC-2.2, AC-2.3) → E2E.
- [x] T12 — Wiki-links: render/navigate, unresolved-link create-on-click, `[[` autocomplete, backlinks panel (AC-3.1–3.4) → E2E.
- [x] T13 — Tags: index, tag list with counts, filter by tag (AC-4.1–4.3) → E2E.
- [x] T14 — Search: MiniSearch in-memory index, incremental update, result navigation (AC-5.1–5.4) → E2E. (1k-note perf assertion deferred to a follow-up spec.)

## Phase E — Sync

- [x] T15 — Local git history: commit encrypted blobs on flush via isomorphic-git (US-6 groundwork) → integration test.
- [x] T16 — Remote config UI + credential storage encrypted in vault (AC-7.1, AC-7.6) → E2E.
- [x] T17 — Sync pipeline: fetch → union-merge (content-addressed trees, no conflicts by construction) → reload CRDTs → push with retry (AC-7.2–7.5, AC-8.1–8.5) → covered by in-process-remote integration tests (full object-graph exchange); HTTP transport itself is library-provided. Two-context E2E against a live git server deferred to a follow-up spec.

## Phase F — PWA & ship

- [x] T18 — PWA: manifest, icons, service worker precaching app shell only (AC-6.3, AC-6.4, AC-9.3) → E2E: offline reload works.
- [x] T19 — Full test pass (unit + E2E stable), fix stragglers (NFR-6).
- [x] T20 — Deploy: CF Pages via wrangler; GitHub repo push; README + docs. → production URL smoke test.


Shipped: https://just-knowledge-base.pages.dev · repo: https://github.com/igor-ganov/just-knowledge-base
Post-deploy smoke: e2e-prod/smoke.spec.ts (playwright.prod.config.ts).
