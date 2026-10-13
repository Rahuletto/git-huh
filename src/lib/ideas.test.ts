import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  counts,
  createIdeasStore,
  newIdea,
  ordered,
  progress,
  repoName,
  splitIdea,
  update,
  type IdeaStorage,
  type ProjectIdea,
} from './ideas';

const idea = (id: string, text: string, createdAt: number, more: Partial<ProjectIdea> = {}): ProjectIdea => ({
  id,
  text,
  createdAt,
  updatedAt: createdAt,
  stage: 'idea',
  steps: [],
  repo: null,
  ...more,
});

test('ideas survive a new store instance, edits and deletion, including multiline unicode', async () => {
  let disk: string | null = null;
  const storage: IdeaStorage = {
    read: async () => disk,
    write: async (raw) => { disk = raw; },
  };
  const first = createIdeasStore(storage);
  assert.deepEqual(await first.load(), []);
  const ideas = [
    idea('one', 'garden journal\ntrack 🌱 growth', 1, { steps: [{ id: 's', text: 'sketch it', done: true }] }),
    idea('two', 'offline map', 2, { stage: 'building', repo: 'me/offline-map' }),
  ];
  await first.save(ideas);
  const reopened = createIdeasStore(storage);
  assert.deepEqual(await reopened.load(), ideas);
  const edited = [{ ...ideas[0], text: 'shared garden journal' }];
  await reopened.save(edited);
  assert.deepEqual(await createIdeasStore(storage).load(), edited);
  await reopened.save([]);
  assert.deepEqual(await first.load(), []);
});

test('unreadable or malformed notebooks fail instead of appearing empty', async () => {
  for (const raw of ['{', '{}', '{"version":3,"ideas":[]}', '{"version":1,"ideas":[{}]}', '{"version":2,"ideas":[{"id":"a"}]}']) {
    const store = createIdeasStore({ read: async () => raw, write: async () => {} });
    await assert.rejects(store.load());
  }
  const store = createIdeasStore({
    read: async () => { throw new Error('read failed'); },
    write: async () => {},
  });
  await assert.rejects(store.load(), /read failed/);
});

test('failed saves surface the failure and leave the previous notebook intact', async () => {
  let disk: string | null = null;
  let fail = false;
  const store = createIdeasStore({
    read: async () => disk,
    write: async (raw) => {
      if (fail) throw new Error('disk full');
      disk = raw;
    },
  });
  const original = [idea('one', 'keep me', 1)];
  await store.save(original);
  fail = true;
  await assert.rejects(store.save([]), /disk full/);
  assert.deepEqual(await store.load(), original);
});

test('blank ideas are rejected before writing to storage', async () => {
  let writes = 0;
  const store = createIdeasStore({ read: async () => null, write: async () => { writes++; } });
  await assert.rejects(store.save([idea('one', ' \n ', 1)]));
  assert.equal(writes, 0);
});

test('a notebook saved before stages opens with every note as an idea', async () => {
  const raw = JSON.stringify({ version: 1, ideas: [{ id: 'a', text: 'old note', createdAt: 5 }] });
  const store = createIdeasStore({ read: async () => raw, write: async () => {} });
  assert.deepEqual(await store.load(), [idea('a', 'old note', 5)]);
});

test('the first line is the name and the rest are notes', () => {
  assert.deepEqual(splitIdea('  watch face\n\nround, amber\nno ticks '), { title: 'watch face', notes: 'round, amber\nno ticks' });
  assert.deepEqual(splitIdea('one line'), { title: 'one line', notes: '' });
});

test('the notebook reads building, next, ideas, shipped, parked, newest first', () => {
  const list = [
    idea('p', 'p', 1, { stage: 'parked' }),
    idea('i1', 'i1', 1),
    idea('b', 'b', 1, { stage: 'building' }),
    idea('i2', 'i2', 2),
    idea('s', 's', 9, { stage: 'shipped' }),
    idea('n', 'n', 1, { stage: 'next' }),
  ];
  assert.deepEqual(ordered(list).map((item) => item.id), ['b', 'n', 'i2', 'i1', 's', 'p']);
  assert.deepEqual(counts(list), { all: 6, idea: 2, next: 1, building: 1, shipped: 1, parked: 1 });
});

test('steps count towards progress and an update touches only its idea', () => {
  const list = [idea('a', 'a', 1, { steps: [{ id: '1', text: 'x', done: true }, { id: '2', text: 'y', done: false }] }), idea('b', 'b', 1)];
  assert.deepEqual(progress(list[0]), { done: 1, total: 2 });
  const next = update(list, 'a', () => ({ stage: 'building' }), 50);
  assert.equal(next[0].stage, 'building');
  assert.equal(next[0].updatedAt, 50);
  assert.equal(next[1], list[1]);
  assert.equal(newIdea('  x  ', 7).text, 'x');
});

test('a repository name is made from the title', () => {
  assert.equal(repoName('Watch Face: Amber edition!'), 'watch-face-amber-edition');
  assert.equal(repoName('  --café map--  '), 'cafe-map');
});
