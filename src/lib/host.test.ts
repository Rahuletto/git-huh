import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  blockedInTheClear,
  bytes,
  demoOverview,
  demoServiceDetail,
  duration,
  isBadLine,
  normalizeUrl,
  showValue,
  since,
  tidyLogLine,
  squeeze,
  uptimeShare,
  verdict,
} from './host';

test('an address is given a scheme and loses its trailing slash and /v1', () => {
  assert.equal(normalizeUrl('desk.tail0.ts.net:8796'), 'http://desk.tail0.ts.net:8796');
  assert.equal(normalizeUrl(' https://desk.ts.net:8797/ '), 'https://desk.ts.net:8797');
  assert.equal(normalizeUrl('http://desk.ts.net:8796/v1/'), 'http://desk.ts.net:8796');
  assert.equal(normalizeUrl('   '), '');
});

test('only plain http outside the tailnet names is refused by a release build', () => {
  assert.equal(blockedInTheClear('http://100.64.0.1:8796'), true);
  assert.equal(blockedInTheClear('http://desk.tail0.ts.net:8796'), false);
  assert.equal(blockedInTheClear('https://example.com'), false);
});

test('squeezing keeps the peak of each run and leaves empty runs empty', () => {
  assert.deepEqual(squeeze([1, 5, 2, 2, null, null], 3), [5, 2, null]);
  assert.deepEqual(squeeze([1, 2], 10), [1, 2]);
  assert.equal(squeeze(Array(360).fill(1), 40).length, 40);
});

test('numbers are shown the way their panel asks', () => {
  assert.equal(showValue(92.53, 'percent'), '93%');
  assert.equal(showValue(0.25, 'percent'), '0.3%');
  assert.equal(showValue(0, 'percent'), '0%');
  assert.equal(showValue(46, 'number', '°c'), '46°c');
  assert.equal(showValue(126, 'number', 'watchers'), '126 watchers');
  assert.equal(showValue(0.58, 'number'), '0.58');
  assert.equal(showValue(3 * 2 ** 30, 'bytes'), '3.0 gb');
  assert.equal(showValue(null, 'number'), '—');
  assert.equal(showValue('ok', 'number'), 'ok');
});

test('durations are short', () => {
  assert.equal(duration(42), '42s');
  assert.equal(duration(3 * 3600 + 5 * 60), '3h 5m');
  assert.equal(duration(4 * 86_400 + 3 * 3600), '4d 3h');
  assert.equal(duration(40 * 86_400), '40d');
  assert.equal(since(1000, 1000 * 1000 + 90_000), '1m');
  assert.equal(bytes(512), '512 b');
});

test('a service that runs but does not answer is not up', () => {
  assert.deepEqual(verdict({ state: 'active', health: null }), { word: 'up', ok: true });
  assert.deepEqual(verdict({ state: 'active', health: { ok: false, detail: '', ms: 0, at: 0 } }), {
    word: 'not answering',
    ok: false,
  });
  assert.equal(verdict({ state: 'inactive' }).word, 'down');
  assert.equal(verdict({ state: 'activating' }).ok, null);
});

test('uptime is the share of readings that were up, ignoring gaps', () => {
  assert.equal(uptimeShare([1, 1, 0, null]), 67);
  assert.equal(uptimeShare([null]), null);
});

test('the demo host has a service page for every service it lists', () => {
  const overview = demoOverview();
  for (const service of overview.services) {
    assert.equal(demoServiceDetail(service.id).id, service.id);
  }
});

test('a journal line loses its stamp, its unit and the timestamp the program printed', () => {
  assert.deepEqual(
    tidyLogLine('2026-10-13T19:25:45+0530 watcher[812]: 2026/10/13 19:25:45 board: fetch_error: timeout'),
    { time: '19:25', text: 'board: fetch_error: timeout' },
  );
  assert.deepEqual(tidyLogLine('plain line'), { time: '', text: 'plain line' });
  assert.equal(isBadLine('board: fetch_error: HTTP 404'), false);
  assert.equal(isBadLine('panic: runtime error'), true);
  assert.equal(isBadLine('ERROR could not bind'), true);
});
