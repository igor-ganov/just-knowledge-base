import git from 'isomorphic-git';
import type { StoragePort } from '../storage/ports';
import { MAIN_REF } from './repo';

/**
 * Union merge (design §5): the merged tree contains every path present in
 * either head. Vault files are append-only and content-addressed, so identical
 * paths carry identical bytes; the only theoretical divergence (vault.json
 * after a concurrent password change) resolves deterministically by larger
 * blob oid — the same choice on every device. Git-level conflicts are thereby
 * impossible by construction (AC-8.4).
 */
type FlatTree = Map<string, { readonly mode: string; readonly oid: string }>;

const flattenTree = async (storage: StoragePort, treeOid: string, prefix: string, into: FlatTree): Promise<void> => {
  const { tree } = await git.readTree({ fs: storage.fs, dir: storage.dir, oid: treeOid });
  for (const entry of tree) {
    const path = prefix === '' ? entry.path : `${prefix}/${entry.path}`;
    if (entry.type === 'tree') {
      await flattenTree(storage, entry.oid, path, into);
    } else {
      into.set(path, { mode: entry.mode, oid: entry.oid });
    }
  }
};

const unionFlatTrees = (ours: FlatTree, theirs: FlatTree): FlatTree => {
  const union: FlatTree = new Map(ours);
  for (const [path, entry] of theirs) {
    const existing = union.get(path);
    const winner = existing === undefined || entry.oid > existing.oid ? entry : existing;
    union.set(path, winner);
  }
  return union;
};

type TreeNode = {
  readonly files: Map<string, { readonly mode: string; readonly oid: string }>;
  readonly dirs: Map<string, TreeNode>;
};

const emptyNode = (): TreeNode => ({ files: new Map(), dirs: new Map() });

const buildHierarchy = (flat: FlatTree): TreeNode => {
  const root = emptyNode();
  for (const [path, entry] of flat) {
    const segments = path.split('/');
    const fileName = segments.at(-1) ?? path;
    const node = segments.slice(0, -1).reduce((current, segment) => {
      const child = current.dirs.get(segment) ?? emptyNode();
      current.dirs.set(segment, child);
      return child;
    }, root);
    node.files.set(fileName, entry);
  }
  return root;
};

const writeTreeNode = async (storage: StoragePort, node: TreeNode): Promise<string> => {
  const entries: Array<{ mode: string; path: string; oid: string; type: 'blob' | 'tree' }> = [];
  for (const [name, child] of node.dirs) {
    entries.push({ mode: '040000', path: name, oid: await writeTreeNode(storage, child), type: 'tree' });
  }
  for (const [name, file] of node.files) {
    entries.push({ mode: file.mode, path: name, oid: file.oid, type: 'blob' });
  }
  return git.writeTree({ fs: storage.fs, dir: storage.dir, tree: entries });
};

const commitTreeOid = async (storage: StoragePort, commitOid: string): Promise<string> => {
  const { commit } = await git.readCommit({ fs: storage.fs, dir: storage.dir, oid: commitOid });
  return commit.tree;
};

/** Merge two heads into a new commit on main; returns the merge commit oid. */
export const unionMergeCommit = async (
  storage: StoragePort,
  localHead: string,
  remoteHead: string,
): Promise<string> => {
  const ours: FlatTree = new Map();
  const theirs: FlatTree = new Map();
  await flattenTree(storage, await commitTreeOid(storage, localHead), '', ours);
  await flattenTree(storage, await commitTreeOid(storage, remoteHead), '', theirs);
  const mergedTree = await writeTreeNode(storage, buildHierarchy(unionFlatTrees(ours, theirs)));
  return git.commit({
    fs: storage.fs,
    dir: storage.dir,
    ref: MAIN_REF,
    tree: mergedTree,
    parent: [localHead, remoteHead],
    message: 'merge: union of device histories',
    author: { name: 'just-knowledge-base', email: 'vault@device' },
  });
};
