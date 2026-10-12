import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mergeLine } from './pullState';

const open = {
  state: 'OPEN' as const,
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeState: 'CLEAN',
  baseRefName: 'main',
  autoMergeOn: false,
};

test('a clean pull request is ready, and says so in yes', () => {
  assert.deepEqual(mergeLine(open), { text: 'ready to merge', tone: 'yes' });
});

test('conflicts outrank everything but merged, closed and draft', () => {
  assert.equal(mergeLine({ ...open, mergeable: 'CONFLICTING', mergeState: 'BLOCKED' }).tone, 'no');
  assert.match(mergeLine({ ...open, mergeable: 'CONFLICTING' }).text, /conflicts with main/);
  assert.equal(mergeLine({ ...open, isDraft: true, mergeable: 'CONFLICTING' }).tone, 'ink');
  assert.equal(mergeLine({ ...open, state: 'MERGED' }).text, 'merged');
});

test('behind, blocked, failing and unknown each say what is in the way', () => {
  assert.match(mergeLine({ ...open, mergeState: 'BEHIND' }).text, /update the branch/);
  assert.equal(mergeLine({ ...open, mergeState: 'BLOCKED' }).tone, 'no');
  assert.match(mergeLine({ ...open, mergeState: 'UNSTABLE' }).text, /can still be merged/);
  assert.match(mergeLine({ ...open, mergeState: 'UNKNOWN' }).text, /still working/);
  assert.match(mergeLine({ ...open, mergeState: 'BLOCKED', autoMergeOn: true }).text, /on its own/);
});
