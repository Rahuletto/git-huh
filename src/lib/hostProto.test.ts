import assert from 'node:assert/strict';
import { test } from 'node:test';

import { create } from '@bufbuild/protobuf';

import { GetOverviewResponseSchema, GetServiceResponseSchema } from '../gen/hostd/v1/host_pb';
import { Display, ViewSchema } from '../gen/hostd/v1/view_pb';
import { points, toOverview, toPanel, toServiceDetail } from './hostProto';

test('a series view keeps its value, its unit and its history, with gaps as null', () => {
  const panel = toPanel(
    create(ViewSchema, {
      id: 'failing',
      title: 'failing now',
      unit: '',
      everySeconds: 60,
      key: 'watcher/status/failing',
      at: { seconds: 1_760_000_000n, nanos: 0 },
      body: { case: 'series', value: { value: { kind: { case: 'number', value: 6 } }, points: [1, NaN, 6] } },
    }),
  );
  assert.equal(panel.kind, 'series');
  assert.equal(panel.value, 6);
  assert.deepEqual(panel.series, [1, null, 6]);
  assert.equal(panel.history, true);
  assert.equal(panel.key, 'watcher/status/failing');
  assert.equal(panel.at, 1_760_000_000);
});

test('every kind of view becomes the value its drawing expects', () => {
  const view = (body: Parameters<typeof create<typeof ViewSchema>>[1]) => toPanel(create(ViewSchema, { id: 'v', title: 'v', ...body }));
  assert.deepEqual(view({ body: { case: 'status', value: { ok: false, text: 'down' } } }).value, { ok: false, text: 'down' });
  assert.deepEqual(view({ body: { case: 'list', value: { lines: ['a', 'b'] } } }).value, ['a', 'b']);
  assert.equal(view({ body: { case: 'log', value: { lines: ['x'] } } }).kind, 'log');
  assert.deepEqual(
    view({ body: { case: 'table', value: { columns: ['a'], rows: [{ cells: ['1'] }], total: 4 } } }).value,
    { columns: ['a'], rows: [['1']], total: 4 },
  );
  assert.deepEqual(view({ body: { case: 'bars', value: { bars: [{ label: 'ok', value: 2 }] } } }).value, [{ label: 'ok', value: 2 }]);
  const stat = view({ display: Display.AGO, max: 100, body: { case: 'stat', value: { value: { kind: { case: 'text', value: 'hi' } } } } });
  assert.equal(stat.value, 'hi');
  assert.equal(stat.display, 'ago');
  assert.equal(stat.max, 100);
  assert.equal(stat.history, false);
});

test('a pending view and a failed one say so instead of a value', () => {
  assert.equal(toPanel(create(ViewSchema, { id: 'a', pending: true })).pending, true);
  const failed = toPanel(create(ViewSchema, { id: 'b', error: 'http 502' }));
  assert.equal(failed.error, 'http 502');
  assert.equal(failed.value, undefined);
});

test('the overview: 64-bit sizes become numbers, NaN becomes a gap', () => {
  const overview = toOverview(
    create(GetOverviewResponseSchema, {
      name: 'desk',
      everySeconds: 10,
      machine: {
        cpuPercent: 12,
        cores: 8,
        memory: { totalBytes: 16n * 2n ** 30n, usedBytes: 2n ** 30n, percent: 6.25, swapUsedBytes: 0n },
        load: [1, 2, 3],
        uptimeSeconds: 99,
        disks: [{ path: '/', totalBytes: 100n, usedBytes: 50n, percent: 50 }],
      },
      history: { cpu: [1, NaN], memory: [], temperature: [] },
      services: [{ id: 'web', name: 'web', state: 'active', memoryBytes: 2048n, cpuPercent: 0.5, history: { cpu: [0.5], up: [1], memory: [] } }],
      configError: '',
    }),
  );
  assert.equal(overview.host.memory.total, 16 * 2 ** 30);
  assert.equal(overview.host.temperature, null);
  assert.deepEqual(overview.host.series.cpu, [1, null]);
  assert.equal(overview.host.disks[0].used, 50);
  assert.equal(overview.services[0].memory, 2048);
  assert.equal(overview.services[0].series.memory, undefined);
  assert.equal(overview.configError, null);
});

test('a service in full: actions, panels, and memory history', () => {
  const detail = toServiceDetail(
    create(GetServiceResponseSchema, {
      everySeconds: 10,
      service: {
        id: 'watcher',
        name: 'page watcher',
        state: 'inactive',
        memoryBytes: 10n,
        url: '',
        actions: [{ id: 'restart', label: 'restart', confirm: true }],
        history: { cpu: [NaN], up: [0], memory: [NaN] },
        views: [{ id: 'n', title: 'n', body: { case: 'stat', value: { value: { kind: { case: 'number', value: 3 } } } } }],
      },
    }),
  );
  assert.ok(detail);
  assert.equal(detail.url, null);
  assert.equal(detail.memory, null, 'a stopped service has no memory to show');
  assert.deepEqual(detail.actions, [{ id: 'restart', label: 'restart', confirm: true }]);
  assert.equal(detail.panels[0].value, 3);
  assert.deepEqual(detail.series.memory, [null]);
  assert.equal(toServiceDetail(create(GetServiceResponseSchema, {})), null);
});

test('points leave numbers alone', () => {
  assert.deepEqual(points([0, 1.5, Infinity]), [0, 1.5, null]);
});
