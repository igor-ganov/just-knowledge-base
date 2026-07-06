import git from 'isomorphic-git';
import type { StoragePort } from '../storage/ports';

const AUTHOR = { name: 'just-knowledge-base', email: 'vault@device' };
export const MAIN_REF = 'refs/heads/main';

export const initRepo = async (storage: StoragePort): Promise<void> => {
  await git.init({ fs: storage.fs, dir: storage.dir, defaultBranch: 'main' });
};

export const headOid = async (storage: StoragePort): Promise<string | undefined> => {
  try {
    return await git.resolveRef({ fs: storage.fs, dir: storage.dir, ref: 'HEAD' });
  } catch {
    return undefined;
  }
};

/** Stage every working-tree change (adds and deletes) and commit if anything changed. */
export const commitAll = async (storage: StoragePort, message: string): Promise<string | undefined> => {
  const matrix = await git.statusMatrix({ fs: storage.fs, dir: storage.dir });
  const changed = matrix.filter(([, head, workdir, stage]) => head !== workdir || workdir !== stage);
  for (const [filepath, , workdir] of changed) {
    await (workdir === 0
      ? git.remove({ fs: storage.fs, dir: storage.dir, filepath })
      : git.add({ fs: storage.fs, dir: storage.dir, filepath }));
  }
  const anythingToCommit = changed.some(([, head, workdir]) => head !== workdir);
  if (!anythingToCommit && (await headOid(storage)) !== undefined) return undefined;
  return git.commit({ fs: storage.fs, dir: storage.dir, message, author: AUTHOR });
};

export const isAncestor = async (
  storage: StoragePort,
  ancestor: string,
  descendant: string,
): Promise<boolean> => {
  if (ancestor === descendant) return true;
  try {
    return await git.isDescendent({
      fs: storage.fs,
      dir: storage.dir,
      oid: descendant,
      ancestor,
      depth: -1,
    });
  } catch {
    return false;
  }
};

export const forceCheckoutMain = async (storage: StoragePort): Promise<void> =>
  git.checkout({ fs: storage.fs, dir: storage.dir, ref: 'main', force: true });

export const setMainTo = async (storage: StoragePort, oid: string): Promise<void> => {
  await git.writeRef({ fs: storage.fs, dir: storage.dir, ref: MAIN_REF, value: oid, force: true });
  await forceCheckoutMain(storage);
};
