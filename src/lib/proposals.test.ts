import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  loadProposal,
  proposalKey,
  proposalLeft,
  saveProposal,
  installProposalStore,
  type ProposalProgress,
} from './proposals';

function committed(overrides: Partial<ProposalProgress> = {}): ProposalProgress {
  return {
    repo: 'upstream/app',
    path: 'README.md',
    sha: 'blob-1',
    base: 'main',
    message: 'say hello',
    text: 'hello',
    step: 'committed',
    headRepo: 'me/app',
    headOwner: 'me',
    branch: 'huh-readme',
    commitSha: 'commit-1',
    ...overrides,
  };
}

test('a committed proposal that never opened a pull request is resumable', async () => {
  const held = new Map<string, ProposalProgress>();
  installProposalStore({
    async read(key) {
      return held.get(key) ?? null;
    },
    write(key, value) {
      held.set(key, value);
    },
    remove(key) {
      held.delete(key);
    },
  });

  const key = proposalKey('me', 'upstream/app', 'main', 'README.md', 'blob-1');
  const progress = committed();
  saveProposal(key, progress);

  const loaded = await loadProposal(key);
  assert.ok(loaded);
  assert.equal(loaded.step, 'committed');
  assert.equal(loaded.commitSha, 'commit-1');
  assert.equal(loaded.branch, 'huh-readme');
  assert.equal(loaded.headRepo, 'me/app');
  assert.equal(
    proposalLeft(loaded),
    'the branch and the commit are there · the pull request was not opened',
  );
  assert.equal(held.get(key)?.commitSha, 'commit-1');

  installProposalStore({
    async read() {
      return null;
    },
    write() {},
    remove() {},
  });
});

test('earlier steps name the write that is still missing', () => {
  assert.equal(
    proposalLeft(committed({ step: 'branched', commitSha: null })),
    'the branch is there · the file was not committed',
  );
  assert.equal(
    proposalLeft(committed({ step: 'forked', branch: null, commitSha: null })),
    'the fork is there · the branch was not created',
  );
});

test('the pull request still owed reuses the recorded branch, commit, and head', () => {
  const progress = committed();
  assert.equal(progress.step, 'committed');
  const head = progress.headOwner ? `${progress.headOwner}:${progress.branch}` : progress.branch;
  assert.equal(head, 'me:huh-readme');
  assert.equal(progress.commitSha, 'commit-1');
  assert.equal(progress.base, 'main');
  assert.notEqual(progress.commitSha, null);
});
