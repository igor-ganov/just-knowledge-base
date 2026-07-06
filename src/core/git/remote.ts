import git, { Errors } from 'isomorphic-git';
import webHttp from 'isomorphic-git/http/web';
import type { StoragePort } from '../storage/ports';

/**
 * GitRemotePort (design §5): the sync engine sees only fetch/push semantics.
 * Web adapter: isomorphic-git smart HTTP through a user-configurable CORS
 * proxy that relays ciphertext only. Tests substitute an in-process remote.
 */
export type RemoteConfig = {
  readonly url: string;
  readonly token: string;
  readonly corsProxy: string;
};

export type GitRemote = {
  /** Make remote objects available locally; returns the remote head oid, if any. */
  readonly fetch: (storage: StoragePort) => Promise<string | undefined>;
  /** Compare-and-set the remote head; throws PushRejectedError on races. */
  readonly push: (storage: StoragePort, head: string) => Promise<void>;
};

export const isPushRejected = (error: unknown): boolean =>
  error instanceof Errors.PushRejectedError ||
  (error instanceof Error && /not a simple fast-forward|failed to update ref/iu.test(error.message));

export const httpRemote = (config: RemoteConfig): GitRemote => {
  const common = (storage: StoragePort) => ({
    fs: storage.fs,
    http: webHttp,
    dir: storage.dir,
    url: config.url,
    ...(config.corsProxy === '' ? {} : { corsProxy: config.corsProxy }),
    onAuth: () => ({ username: config.token, password: 'x-oauth-basic' }),
  });
  return {
    fetch: async (storage) => {
      const result = await git.fetch({
        ...common(storage),
        ref: 'main',
        singleBranch: true,
        tags: false,
      });
      return result.fetchHead ?? undefined;
    },
    push: async (storage) => {
      const result = await git.push({
        ...common(storage),
        ref: 'main',
        remoteRef: 'refs/heads/main',
      });
      if (result.ok !== true) throw new Errors.PushRejectedError('not-fast-forward');
    },
  };
};
