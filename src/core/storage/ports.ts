/**
 * Platform ports (design §1, NFR-4). Web adapters: LightningFS + isomorphic-git
 * HTTP. Tauri shells will substitute native FS/git without touching callers.
 */
export type FsPromises = {
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly writeFile: (path: string, data: Uint8Array | string) => Promise<void>;
  readonly mkdir: (path: string) => Promise<unknown>;
  readonly readdir: (path: string) => Promise<ReadonlyArray<string>>;
  readonly unlink: (path: string) => Promise<void>;
  readonly rmdir: (path: string) => Promise<void>;
  readonly stat: (path: string) => Promise<unknown>;
  readonly lstat: (path: string) => Promise<unknown>;
  readonly readlink?: (path: string) => Promise<unknown>;
  readonly symlink?: (target: string, path: string) => Promise<unknown>;
  /** LightningFS: force the debounced superblock to IndexedDB now. */
  readonly flush?: () => Promise<void>;
};

export const persistStorage = async (storage: StoragePort): Promise<void> => {
  await storage.fs.promises.flush?.();
};

/** Shape isomorphic-git accepts as its `fs` option and we use directly. */
export type VaultFs = { readonly promises: FsPromises };

export type StoragePort = {
  readonly fs: VaultFs;
  readonly dir: string;
};

export const joinPath = (...parts: ReadonlyArray<string>): string =>
  parts.join('/').replaceAll('//', '/');

const errorCode = (error: unknown): string =>
  error instanceof Error && 'code' in error ? String(error.code) : '';

const isMissingError = (error: unknown): boolean =>
  errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR';

export const ensureDir = async (storage: StoragePort, relative: string): Promise<void> => {
  const segments = relative.split('/').filter((segment) => segment.length > 0);
  const paths = segments.map((_, index) => joinPath(storage.dir, ...segments.slice(0, index + 1)));
  for (const path of paths) {
    await storage.fs.promises.mkdir(path).catch(() => undefined);
  }
};

export const readFileOrUndefined = async (
  storage: StoragePort,
  relative: string,
): Promise<Uint8Array | undefined> => {
  try {
    return await storage.fs.promises.readFile(joinPath(storage.dir, relative));
  } catch (error) {
    if (isMissingError(error)) return undefined;
    throw error;
  }
};

export const listDirOrEmpty = async (
  storage: StoragePort,
  relative: string,
): Promise<ReadonlyArray<string>> => {
  try {
    return await storage.fs.promises.readdir(joinPath(storage.dir, relative));
  } catch (error) {
    if (isMissingError(error)) return [];
    throw error;
  }
};
