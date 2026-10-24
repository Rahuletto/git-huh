import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSavedStore, type SavedBackend } from './savedStore';

function fixture(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const operations: string[] = [];
  const backend: SavedBackend = {
    async read(id) {
      return files.get(id) ?? null;
    },
    async write(id, raw) {
      operations.push(`write:${id}`);
      files.set(id, raw);
    },
    async remove(id) {
      operations.push(`remove:${id}`);
      files.delete(id);
    },
    async list() {
      return [...files].map(([id, raw]) => ({
        id,
        bytes: new TextEncoder().encode(raw).byteLength,
        at: 1,
      }));
    },
  };
  return { files, operations, backend };
}

const envelope = (value: unknown, at = 1) => JSON.stringify({ value, at });

test('migration budgets unindexed cache files and preserves authored records', async () => {
  const disk = fixture({
    '~index': envelope({ known: { bytes: 1, at: 1, pinned: false } }),
    known: envelope('old'),
    legacy: envelope('unindexed'),
    corrupt: '{broken',
    draft: envelope('unsent words'),
    proposal: envelope('pending commit'),
    settings: envelope({ theme: 'dark' }),
  });
  const store = createSavedStore(disk.backend, {
    durable: (id) => ['draft', 'proposal', 'settings'].includes(id),
  });

  await store.prune(0);

  assert.equal(disk.files.has('known'), false);
  assert.equal(disk.files.has('legacy'), false);
  assert.equal(disk.files.has('corrupt'), false);
  assert.equal(disk.files.has('draft'), true);
  assert.equal(disk.files.has('proposal'), true);
  assert.equal(disk.files.has('settings'), true);
  const firstRemoval = disk.operations.findIndex((operation) => operation.startsWith('remove:'));
  assert.ok(disk.operations.indexOf('write:~index') < firstRemoval);
  const savedIndex = JSON.parse(disk.files.get('~index')!).value;
  assert.equal(savedIndex.version, 2);
  await store.flush();
});

test('a failed migration index write does not delete any cache file', async () => {
  const disk = fixture({ legacy: envelope('unindexed') });
  disk.backend.write = async () => {
    throw new Error('disk full');
  };
  const store = createSavedStore(disk.backend);

  await assert.rejects(store.prune(0), /disk full/);
  assert.equal(disk.files.has('legacy'), true);
});

test('removal waits for an in-flight write and cannot be resurrected by it', async () => {
  const disk = fixture();
  const write = disk.backend.write;
  let releaseWrite!: () => void;
  let writeStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    writeStarted = resolve;
  });
  disk.backend.write = async (id, raw) => {
    if (id === 'account-file') {
      writeStarted();
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    }
    await write(id, raw);
  };
  const store = createSavedStore(disk.backend);

  const saving = store.write('account-file', 'old snapshot');
  await started;
  const removing = store.removePrefixes(['account-']);
  releaseWrite();
  await Promise.all([saving, removing]);
  await store.flush();

  assert.equal(disk.files.has('account-file'), false);
});

test('a protected-record write rejects when persistence fails', async () => {
  const disk = fixture();
  disk.backend.write = async (id, raw) => {
    if (id === 'draft') throw new Error('storage unavailable');
    disk.files.set(id, raw);
  };
  const store = createSavedStore(disk.backend, { durable: (id) => id === 'draft' });

  await assert.rejects(store.write('draft', 'my unsent words'), /storage unavailable/);
  assert.equal(disk.files.has('draft'), false);
});

test('the app policy keeps drafts, proposals, settings, and triage outside the cache budget', async () => {
  const protectedIds = [
    'alice_1_draft_1_comment_1_123',
    'alice_1_proposal_1_owner_2f_repo',
    'home-settings',
    'accounts-together',
    'notify-settings',
    'alice-triage',
    'alice-notified',
  ];
  const disk = fixture(Object.fromEntries([
    ...protectedIds.map((id) => [id, envelope('authored')] as const),
    ['alice_1_pull_1_123', envelope('cached response')],
  ]));
  const store = createSavedStore(disk.backend);

  await store.prune(0);

  assert.equal(disk.files.has('alice_1_pull_1_123'), false);
  for (const id of protectedIds) assert.equal(disk.files.has(id), true, id);
  await store.flush();
});

test('unchanged values skip disk writes while remembered bodies stay within a byte budget', async () => {
  const disk = fixture();
  let clock = 1;
  const store = createSavedStore(disk.backend, { now: () => clock++, rememberedBytes: 6 });

  await store.write('a', 'x');
  await store.write('a', 'x');
  assert.equal(disk.operations.filter((operation) => operation === 'write:a').length, 1);
  await store.write('b', 'y');
  await store.write('c', 'z');
  await store.write('a', 'x');

  assert.equal(disk.operations.filter((operation) => operation === 'write:a').length, 2);
  await store.flush();
});

test('cache eviction counts UTF-8 bytes rather than UTF-16 string length', async () => {
  const raw = envelope('😀');
  const disk = fixture({ unicode: raw });
  const store = createSavedStore(disk.backend);

  await store.prune(raw.length);

  assert.equal(disk.files.has('unicode'), false);
  await store.flush();
});
