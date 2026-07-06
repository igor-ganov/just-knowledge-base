import { Data, Effect } from 'effect';
import type { StoragePort } from '../storage/ports';
import { forceCheckoutMain, headOid, isAncestor, setMainTo } from './repo';
import { isPushRejected, type GitRemote } from './remote';
import { unionMergeCommit } from './unionMerge';

/**
 * Sync pipeline (design §5): fetch → converge (fast-forward either way, or
 * union-merge) → push, retrying when another device wins the push race.
 * Local data is never modified destructively: every step only adds commits
 * or moves `main` forward to a commit containing the union (AC-7.5).
 */
export class SyncError extends Data.TaggedError('SyncError')<{
  readonly stage: 'fetch' | 'merge' | 'push' | 'races-exhausted';
  readonly cause: unknown;
}> {}

export type SyncOutcome = {
  readonly merged: boolean;
  readonly head: string;
};

const MAX_RACE_RETRIES = 3;

type AttemptResult = { readonly kind: 'converged'; readonly merged: boolean } | { readonly kind: 'race' };

const attemptSync = async (storage: StoragePort, remote: GitRemote): Promise<AttemptResult> => {
  const remoteHead = await remote.fetch(storage);
  const localHead = await headOid(storage);
  if (localHead === undefined) throw new Error('vault repository has no commits');

  const tryPush = async (merged: boolean): Promise<AttemptResult> => {
    try {
      await remote.push(storage, (await headOid(storage)) ?? localHead);
      return { kind: 'converged', merged };
    } catch (error) {
      if (isPushRejected(error)) return { kind: 'race' };
      throw error;
    }
  };

  switch (true) {
    case remoteHead === undefined:
      return tryPush(false);
    case remoteHead === localHead:
      return { kind: 'converged', merged: false };
    case await isAncestor(storage, remoteHead ?? '', localHead):
      return tryPush(false);
    case await isAncestor(storage, localHead, remoteHead ?? ''): {
      await setMainTo(storage, remoteHead ?? '');
      return { kind: 'converged', merged: true };
    }
    default: {
      await unionMergeCommit(storage, localHead, remoteHead ?? '');
      await forceCheckoutMain(storage);
      return tryPush(true);
    }
  }
};

const runSync = async (storage: StoragePort, remote: GitRemote): Promise<SyncOutcome> => {
  let sawMerge = false;
  for (let attempt = 0; attempt < MAX_RACE_RETRIES; attempt += 1) {
    const result = await attemptSync(storage, remote);
    if (result.kind === 'converged') {
      return { merged: sawMerge || result.merged, head: (await headOid(storage)) ?? '' };
    }
    sawMerge = true;
  }
  throw new SyncError({ stage: 'races-exhausted', cause: 'push kept being rejected' });
};

export const syncVault = (storage: StoragePort, remote: GitRemote): Effect.Effect<SyncOutcome, SyncError> =>
  Effect.tryPromise({
    try: () => runSync(storage, remote),
    catch: (cause) => (cause instanceof SyncError ? cause : new SyncError({ stage: 'fetch', cause })),
  });
