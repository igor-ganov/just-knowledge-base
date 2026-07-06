import git, { Errors } from 'isomorphic-git';
import type { StoragePort } from '../storage/ports';
import { headOid, isAncestor, MAIN_REF } from './repo';

/**
 * In-process GitRemote for integration tests (design §8): a plain repository
 * directory plays the remote; fetch/push copy the commit closure object by
 * object. This exercises the full sync/merge logic while substituting only the
 * HTTP transport, which stays library-provided in production.
 */
import type { GitRemote } from './remote';

const hasObject = async (storage: StoragePort, oid: string): Promise<boolean> => {
  try {
    await git.readObject({ fs: storage.fs, dir: storage.dir, oid, format: 'content' });
    return true;
  } catch {
    return false;
  }
};

const copyObject = async (source: StoragePort, target: StoragePort, oid: string): Promise<string> => {
  const { type, object } = await git.readObject({ fs: source.fs, dir: source.dir, oid, format: 'content' });
  if (type === 'commit' || type === 'tree' || type === 'blob' || type === 'tag') {
    await git.writeObject({ fs: target.fs, dir: target.dir, type, object, format: 'content' });
  }
  return type;
};

const copyClosure = async (source: StoragePort, target: StoragePort, head: string): Promise<void> => {
  const pending: string[] = [head];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const oid = pending.pop() ?? '';
    if (oid === '' || visited.has(oid)) continue;
    visited.add(oid);
    if (await hasObject(target, oid)) continue;
    const type = await copyObject(source, target, oid);
    if (type === 'commit') {
      const { commit } = await git.readCommit({ fs: source.fs, dir: source.dir, oid });
      pending.push(commit.tree, ...commit.parent);
    }
    if (type === 'tree') {
      const { tree } = await git.readTree({ fs: source.fs, dir: source.dir, oid });
      pending.push(...tree.map((entry) => entry.oid));
    }
  }
};

export const inProcessRemote = (remoteRepo: StoragePort): GitRemote => ({
  fetch: async (local) => {
    const remoteHead = await headOid(remoteRepo);
    if (remoteHead !== undefined) await copyClosure(remoteRepo, local, remoteHead);
    return remoteHead;
  },
  push: async (local, head) => {
    const remoteHead = await headOid(remoteRepo);
    const fastForward = remoteHead === undefined || (await isAncestor(local, remoteHead, head));
    if (!fastForward) throw new Errors.PushRejectedError('not-fast-forward');
    await copyClosure(local, remoteRepo, head);
    await git.writeRef({ fs: remoteRepo.fs, dir: remoteRepo.dir, ref: MAIN_REF, value: head, force: true });
  },
});
