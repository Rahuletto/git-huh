import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cancelResourceWork,
  getResourceSnapshot,
  isCurrentResourceGeneration,
  publishResource,
  publishResourceForGeneration,
  startResourceWork,
  subscribeResource,
} from './resourceStore';

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

test('cancelling a resource aborts its old work and prevents late publication', async () => {
  const key = 'resource-store-cancel-race';
  let resolveOld!: (value: string) => void;
  const old = startResourceWork(key, () => {
    return new Promise<string>((resolve) => {
      resolveOld = resolve;
    });
  });
  void old.promise.catch(() => {});
  await Promise.resolve();

  cancelResourceWork(key);
  assert.equal(old.signal.aborted, true);

  const current = startResourceWork(key, async () => 'current');
  assert.equal(await current.promise, 'current');
  assert.equal(isCurrentResourceGeneration(key, current.generation), true);
  assert.equal(
    publishResourceForGeneration(key, current.generation, { value: 'current' }),
    true,
  );

  resolveOld('stale');
  await old.promise;
  assert.equal(isCurrentResourceGeneration(key, old.generation), false);
  assert.equal(
    publishResourceForGeneration(key, old.generation, { value: 'stale' }),
    false,
  );
  assert.equal(getResourceSnapshot<string>(key).value, 'current');
});
