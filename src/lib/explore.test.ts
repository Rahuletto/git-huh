import assert from 'node:assert/strict';
import { test } from 'node:test';

import { searchQuery } from './explore';

test('issues and pull requests share a search type and are told apart by qualifier', () => {
  assert.deepEqual(searchQuery('issues', ' crash '), { type: 'ISSUE', query: 'crash is:issue' });
  assert.deepEqual(searchQuery('pulls', 'crash'), { type: 'ISSUE', query: 'crash is:pr' });
});

test('a qualifier the person typed is left alone', () => {
  assert.deepEqual(searchQuery('issues', 'is:pr author:me'), { type: 'ISSUE', query: 'is:pr author:me' });
  assert.deepEqual(searchQuery('repos', 'expo'), { type: 'REPOSITORY', query: 'expo' });
  assert.deepEqual(searchQuery('users', 'octo'), { type: 'USER', query: 'octo' });
});
