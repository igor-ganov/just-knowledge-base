# Requirements — Public/Private Spaces

## Overview

The vault splits into two spaces. **Public** is unencrypted and shared by every
user of the git repository (team knowledge). **Private** is per-user and
encrypted with that user's vault key; other users cannot read it. Every note
lives in exactly one space and can be moved.

## Acceptance criteria

- **AC-S1** THE SYSTEM SHALL store public notes (content + catalog/folders) as PLAINTEXT CRDT blobs under `public/`; private notes stay AEAD-encrypted under the user's private prefix (`private/<login>/`, legacy root layout still readable).
- **AC-S2** New notes default to the private space; the editor SHALL offer a per-note space switch; moving copies the CRDT state into the target space and tombstones the source (WHEN moved THE SYSTEM SHALL show the note only in the target space afterwards).
- **AC-S3** The file panel SHALL show two sections — Private and Public — each with its own folder tree.
- **AC-S4** Search, tags, wiki-links, and backlinks SHALL work across both spaces transparently.
- **AC-S5** Sync SHALL carry both spaces; public content converges for all users; private content converges per user. A user without the key of someone else's private space SHALL see none of its content (undecryptable blobs are skipped, reported only as diagnostics).
- **AC-S6** WHEN no identity is connected THE SYSTEM SHALL use the device-local user for the private prefix; connecting a GitHub identity switches the prefix to the login (previous local data stays readable via fallback).

## Deviations / follow-ups (design honesty)

- Git fetch is whole-repo: other users' private dirs are downloaded but remain
  ciphertext; "download only when access" is a transport optimization deferred
  (needs server-side filtering, contradicts dumb-remote constraint).
- Teammate onboarding into a shared repo (creating a second user's manifest in
  `private/<login>/vault.json`) is a follow-up spec (`team-onboarding`).
