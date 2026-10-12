import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eventually } from './eventually';
import { GitHubError } from './github';

const instant = async () => {};

test('a miss is asked again until it is found', async () => {
  let calls = 0;
  const found = await eventually(
    async () => {
      calls++;
      if (calls < 3) throw new GitHubError('missing', 'not yet');
      return 'here';
    },
    { sleep: instant },
  );
  assert.equal(found, 'here');
  assert.equal(calls, 3);
});

test('null counts as a miss, and gives up after the tries', async () => {
  let calls = 0;
  const found = await eventually(async () => {
    calls++;
    return null;
  }, { tries: 3, sleep: instant });
  assert.equal(found, null);
  assert.equal(calls, 3);
});

test('any other failure is not retried', async () => {
  let calls = 0;
  await assert.rejects(
    eventually(async () => {
      calls++;
      throw new GitHubError('forbidden', 'no');
    }, { sleep: instant }),
  );
  assert.equal(calls, 1);
});
