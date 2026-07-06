import { utf8Decode, utf8Encode } from '@core/crypto/bytes';
import { openRecord, sealRecord } from '@core/crypto/envelope';
import { ensureDir, joinPath, readFileOrUndefined } from '@core/storage/ports';
import type { VaultHandle } from '@features/vault/vaultService';

/**
 * Remote settings (AC-7.1). The token is a secret: it is AEAD-encrypted with
 * the vault DEK and stored inside the repository, so it syncs between the
 * user's devices but never exists in plaintext at rest or on the remote.
 */
export type SyncSettings = {
  readonly url: string;
  readonly token: string;
  readonly corsProxy: string;
};

const SCOPE = 'config';
const FILE = 'config/sync.bin';

export const defaultCorsProxy = 'https://cors.isomorphic-git.org';

export const readSyncSettings = async (handle: VaultHandle): Promise<SyncSettings | undefined> => {
  const sealed = await readFileOrUndefined(handle.storage, FILE);
  if (sealed === undefined) return undefined;
  try {
    const opened = await openRecord(handle.dek, SCOPE, sealed);
    return JSON.parse(utf8Decode(opened)) as SyncSettings;
  } catch {
    return undefined;
  }
};

export const writeSyncSettings = async (handle: VaultHandle, settings: SyncSettings): Promise<void> => {
  const sealed = await sealRecord(handle.dek, SCOPE, utf8Encode(JSON.stringify(settings)));
  await ensureDir(handle.storage, 'config');
  await handle.storage.fs.promises.writeFile(joinPath(handle.storage.dir, FILE), sealed);
};
