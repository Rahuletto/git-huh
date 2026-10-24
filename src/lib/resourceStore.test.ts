import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getResourceSnapshot, publishResource, subscribeResource } from './resourceStore';

test('publishing replaces the stable resource snapshot before notifying listeners', () => {
  const key = 'resource-store-snapshot-identity';
  const initial = getResourceSnapshot<string>(key);
  let notifications = 0;
  const unsubscribe = subscribeResource(key, () => {
    notifications += 1;
  });

  publishResource(key, { value: 'loaded', loading: false, refreshing: false });

  const next = getResourceSnapshot<string>(key);
  assert.equal(notifications, 1);
  assert.notEqual(next, initial);
  assert.equal(next.value, 'loaded');
  assert.equal(getResourceSnapshot(key), next);
  unsubscribe();
});
