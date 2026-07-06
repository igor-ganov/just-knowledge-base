import LightningFS from '@isomorphic-git/lightning-fs';
import type { StoragePort, VaultFs } from '@core/storage/ports';

/**
 * Web StoragePort adapter (NFR-4): LightningFS persists to IndexedDB and is
 * the battle-tested pairing for isomorphic-git in browsers (design §2.2).
 * Tauri shells will provide a native-FS StoragePort behind the same type.
 */
const FS_NAME = 'jkb-vault';
const VAULT_DIR = '/vault';

export const createWebStorage = (): StoragePort => {
  const fs: VaultFs = new LightningFS(FS_NAME);
  return { fs, dir: VAULT_DIR };
};
