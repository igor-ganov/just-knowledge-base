import { sha256Hex, utf8Decode, utf8Encode } from '../crypto/bytes';
import { openRecord, sealRecord } from '../crypto/envelope';
import type { VaultManifest } from '../crypto/keys';
import { ensureDir, joinPath, listDirOrEmpty, readFileOrUndefined, type StoragePort } from './ports';

/**
 * Vault-on-git layout (design §4):
 *   vault.json                     public manifest
 *   catalog/<sha256>.bin           encrypted catalog update blobs (append-only)
 *   notes/<noteId>/<sha256>.bin    encrypted note update blobs (append-only)
 * AAD binds blobs to their logical scope ('catalog' or 'notes/<id>') so a blob
 * moved between scopes fails authentication (design §2.3).
 */
const MANIFEST_FILE = 'vault.json';

export const readManifest = async (storage: StoragePort): Promise<VaultManifest | undefined> => {
  const raw = await readFileOrUndefined(storage, MANIFEST_FILE);
  return raw === undefined ? undefined : (JSON.parse(utf8Decode(raw)) as VaultManifest);
};

export const writeManifest = async (storage: StoragePort, manifest: VaultManifest): Promise<void> =>
  storage.fs.promises.writeFile(
    joinPath(storage.dir, MANIFEST_FILE),
    utf8Encode(JSON.stringify(manifest, undefined, 2)),
  );

/**
 * Space-aware physical layout (spec spaces, AC-S1). The AAD scope stays
 * logical ('catalog', 'notes/<id>') — physical prefixes can migrate freely.
 * `dek === undefined` means the public space: plaintext blobs.
 */
export type SpacePaths = {
  /** '' for the legacy root layout, 'public' or 'private/<login>'. */
  readonly prefix: string;
  /** Extra prefixes consulted on read (legacy migration, AC-S6). */
  readonly readFallbacks: ReadonlyArray<string>;
};

const withPrefix = (prefix: string, relative: string): string =>
  prefix === '' ? relative : joinPath(prefix, relative);

const writeSealedBlob = async (
  storage: StoragePort,
  dek: CryptoKey | undefined,
  paths: SpacePaths,
  scope: string,
  plaintext: Uint8Array,
): Promise<string> => {
  const sealed = dek === undefined ? plaintext : await sealRecord(dek, scope, plaintext);
  const name = `${await sha256Hex(sealed)}.bin`;
  const directory = withPrefix(paths.prefix, scope);
  await ensureDir(storage, directory);
  const relative = joinPath(directory, name);
  await storage.fs.promises.writeFile(joinPath(storage.dir, relative), sealed);
  return relative;
};

export type CorruptBlob = { readonly path: string; readonly reason: string };
export type BlobReadResult = {
  readonly blobs: ReadonlyArray<Uint8Array>;
  readonly corrupt: ReadonlyArray<CorruptBlob>;
};

/** AC-6.5: corrupt blobs are reported and skipped, the intact remainder loads. */
const readSealedBlobs = async (
  storage: StoragePort,
  dek: CryptoKey | undefined,
  paths: SpacePaths,
  scope: string,
): Promise<BlobReadResult> => {
  const blobs: Uint8Array[] = [];
  const corrupt: CorruptBlob[] = [];
  for (const prefix of [paths.prefix, ...paths.readFallbacks]) {
    const directory = withPrefix(prefix, scope);
    const names = (await listDirOrEmpty(storage, directory)).filter((name) => name.endsWith('.bin'));
    for (const name of names.toSorted()) {
      const relative = joinPath(directory, name);
      try {
        const sealed = await readFileOrUndefined(storage, relative);
        if (sealed === undefined) continue;
        blobs.push(dek === undefined ? sealed : await openRecord(dek, scope, sealed));
      } catch (error) {
        corrupt.push({ path: relative, reason: error instanceof Error ? error.message : 'unreadable' });
      }
    }
  }
  return { blobs, corrupt };
};

export const writeCatalogBlob = (
  storage: StoragePort,
  dek: CryptoKey | undefined,
  paths: SpacePaths,
  blob: Uint8Array,
): Promise<string> => writeSealedBlob(storage, dek, paths, 'catalog', blob);

export const readCatalogBlobs = (
  storage: StoragePort,
  dek: CryptoKey | undefined,
  paths: SpacePaths,
): Promise<BlobReadResult> => readSealedBlobs(storage, dek, paths, 'catalog');

export const writeNoteBlob = (
  storage: StoragePort,
  dek: CryptoKey | undefined,
  paths: SpacePaths,
  noteId: string,
  blob: Uint8Array,
): Promise<string> => writeSealedBlob(storage, dek, paths, `notes/${noteId}`, blob);

export const readNoteBlobs = (
  storage: StoragePort,
  dek: CryptoKey | undefined,
  paths: SpacePaths,
  noteId: string,
): Promise<BlobReadResult> => readSealedBlobs(storage, dek, paths, `notes/${noteId}`);
