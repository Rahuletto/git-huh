import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { firstFreePatchName, patchStem, timestampPatchName } from './branchName';

describe('firstFreePatchName', () => {
  const stem = patchStem('Ada');

  it('starts at 1 when nothing exists', () => {
    assert.equal(firstFreePatchName(stem, []), 'ada-patch-1');
  });

  it('skips names that matching-refs already returned, full ref or bare', () => {
    const existing = ['refs/heads/ada-patch-1', 'ada-patch-2', 'refs/heads/ada-patch-4'];
    assert.equal(firstFreePatchName(stem, existing), 'ada-patch-3');
  });

  it('ignores other stems and non-numeric suffixes', () => {
    const existing = ['refs/heads/other-patch-1', 'refs/heads/ada-patch-notes', 'refs/heads/ada-patch-01'];
    assert.equal(firstFreePatchName(stem, existing), 'ada-patch-1');
  });

  it('does not walk past the limit, however many branches exist', () => {
    const existing = Array.from({ length: 30 }, (_, index) => `refs/heads/${stem}-${index + 1}`);
    assert.equal(firstFreePatchName(stem, existing), null);
    assert.equal(timestampPatchName(stem, 1_700_000_000_000).startsWith('ada-patch-'), true);
  });
});
