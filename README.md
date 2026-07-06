# just-knowledge-base

A local-first, end-to-end-encrypted personal knowledge base. Markdown notes with
wiki-links, backlinks, tags, and instant full-text search — all data encrypted
on your device with a key derived from your master password. Optional sync
pushes the vault, already encrypted, to any git remote you control; concurrent
edits from multiple devices merge automatically via CRDTs.

## How it works

- **Vault = git repository.** Notes are Yjs CRDT documents, persisted as
  append-only, content-addressed, AEAD-encrypted blobs inside a local git repo
  (IndexedDB in the browser). Git history is the storage format, not an add-on.
- **Encryption.** Master password → Argon2id → key-encryption key; a random
  data key (non-extractable WebCrypto AES-256-GCM) encrypts every record. The
  remote, and even the CORS proxy, only ever see ciphertext. There is **no
  password recovery** by design.
- **Conflict-free sync.** Sync is fetch → union-merge → push. Because blobs are
  append-only and content-addressed, a git conflict is impossible by
  construction; concurrent edits to the same note merge at character level, and
  an edit concurrent with a delete wins (nothing is silently lost).

## Development

```sh
bun install
bun run dev        # dev server
bun test src       # unit + integration tests (crypto, CRDT, two-device sync)
bun run test:e2e   # Playwright E2E (builds are served via astro preview)
bun run build      # static build to dist/
bun run deploy     # build + wrangler pages deploy
```

Stack: Astro + Lit + Effect-TS + TypeScript, Yjs, isomorphic-git + LightningFS,
hash-wasm (Argon2id), WebCrypto, MiniSearch, CodeMirror 6, bun, Playwright.

## Specs

Spec-driven: see `specs/knowledge-base-mvp/` — `requirements.md` (EARS
acceptance criteria), `design.md` (architecture and trade-offs), `tasks.md`
(implementation log). The spec, not the code, is the source of truth.

Planned follow-up specs: `desktop-shell` and `mobile-shell` — Tauri v2 wrappers
substituting native FS/git/keystore adapters behind the existing ports.

## Sync setup

1. Create an empty private repository on any git host (GitHub, GitLab, Gitea…).
2. In the app: Settings → repository URL + access token (for GitHub, a
   fine-grained PAT with contents read/write on that one repo).
3. The browser build talks smart-HTTP through a CORS proxy (configurable;
   ciphertext only). Press **Sync** — the first sync uploads your vault; on a
   second device choose **“Connect an existing vault from a git remote”** on
   the first-run screen and enter the same remote and master password.

## License

[MIT](LICENSE)
