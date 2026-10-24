/**
 * A file proposal that may have stopped halfway.
 *
 * Forking, creating a branch, committing the file and opening the pull
 * request are four writes. If the last one fails, the earlier ones have
 * already happened, and starting again would make a second branch and a
 * second commit of the same change. The progress is the identifiers those
 * writes returned, keyed by the file the proposal started from, so a later
 * attempt can finish only the steps that have not happened yet.
 *
 * Cancellation stops the wait. It does not delete a branch or undo a commit:
 * those are already on GitHub, and rolling them back would hide work the
 * person asked for.
 */

import { composeKey } from './cacheKey';

export type ProposalStep = 'forked' | 'branched' | 'committed';

/**
 * Where a half-finished proposal survives a restart. The app registers the
 * disk-backed one (`proposalsStore.ts`); everything else — including the pure
 * modules the unit tests import — keeps it in memory, so no test has to load
 * `expo-file-system` to import `writes.ts`.
 */
export interface ProposalStore {
  read(key: string): Promise<ProposalProgress | null>;
  write(key: string, value: ProposalProgress): void;
  remove(key: string): void;
}

/** The proposal this session is looking at, ahead of whatever the box holds. */
const current = new Map<string, ProposalProgress>();

const memoryStore: ProposalStore = {
  async read(key) {
    return current.get(key) ?? null;
  },
  write(key, value) {
    current.set(key, value);
  },
  remove(key) {
    current.delete(key);
  },
};

let backing: ProposalStore = memoryStore;

/** Called once by the app to keep proposals on the device. */
export function installProposalStore(store: ProposalStore): void {
  backing = store;
}

export interface ProposalProgress {
  repo: string;
  path: string;
  /** Blob sha the commit was based on. A different sha is a different proposal. */
  sha: string;
  base: string;
  message: string;
  text: string;
  step: ProposalStep;
  headRepo: string;
  headOwner: string | null;
  branch: string | null;
  commitSha: string | null;
}

export function proposalKey(account: string | null, repo: string, ref: string, path: string, sha: string): string {
  return composeKey(account, 'proposal', repo, ref, path, sha);
}

export function readProposal(key: string): ProposalProgress | null {
  return current.get(key) ?? null;
}

export function saveProposal(key: string, progress: ProposalProgress): void {
  current.set(key, progress);
  backing.write(key, progress);
}

export function clearProposal(key: string): void {
  current.delete(key);
  backing.remove(key);
}

export async function loadProposal(key: string): Promise<ProposalProgress | null> {
  const held = current.get(key);
  if (held) return held;
  const saved = await backing.read(key);
  if (!saved) return null;
  current.set(key, saved);
  return saved;
}

/** What a partially finished proposal still needs, in the words of the screen. */
export function proposalLeft(progress: ProposalProgress): string {
  if (progress.step === 'committed') return 'the branch and the commit are there · the pull request was not opened';
  if (progress.step === 'branched') return 'the branch is there · the file was not committed';
  return 'the fork is there · the branch was not created';
}
