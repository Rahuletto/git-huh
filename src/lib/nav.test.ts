import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pullRoute, routeForUrl } from './nav';

test('a repository link opens the repository', () => {
  assert.deepEqual(routeForUrl('https://github.com/expo/expo'), { kind: 'repo', repo: 'expo/expo' });
  assert.deepEqual(routeForUrl('https://www.github.com/expo/expo.git'), {
    kind: 'repo',
    repo: 'expo/expo',
  });
});

test('pull requests, issues and discussions open their own pages', () => {
  assert.deepEqual(routeForUrl('https://github.com/a/b/pull/12#discussion_r1'), {
    kind: 'pull',
    repo: 'a/b',
    number: 12,
    tab: 'talk',
  });
  assert.deepEqual(routeForUrl('https://github.com/a/b/issues/7?q=1'), {
    kind: 'thread',
    repo: 'a/b',
    number: 7,
    type: 'issue',
  });
  assert.deepEqual(routeForUrl('https://github.com/a/b/discussions/3'), {
    kind: 'thread',
    repo: 'a/b',
    number: 3,
    type: 'discussion',
  });
});

test('a file link keeps its ref and decodes its path', () => {
  assert.deepEqual(routeForUrl('https://github.com/a/b/blob/main/docs/read%20me.md'), {
    kind: 'file',
    repo: 'a/b',
    ref: 'main',
    path: 'docs/read me.md',
  });
});

test('anything it cannot place stays a link', () => {
  for (const url of [
    'https://example.com/a/b',
    'https://github.com/settings/tokens',
    'https://github.com/orgs/expo/people',
    'https://github.com/a/b/wiki/Home',
    'https://github.com/settings',
    'https://github.com/a/b/pull/not-a-number',
    'https://github.com/a/b/blob/main',
    'https://github.com/a/b/blob/main/%E0%A4%A.md',
  ]) {
    assert.equal(routeForUrl(url), null, url);
  }
});

test('a profile, a gist and the parts of a repository open their own pages', () => {
  assert.deepEqual(routeForUrl('https://github.com/octocat'), { kind: 'user', login: 'octocat' });
  assert.deepEqual(routeForUrl('https://github.com/octocat/?tab=repositories'), {
    kind: 'user',
    login: 'octocat',
  });
  assert.deepEqual(routeForUrl('https://gist.github.com/octocat/6cad326836d38bd3a7ae'), {
    kind: 'gist',
    id: '6cad326836d38bd3a7ae',
  });
  assert.deepEqual(routeForUrl('https://github.com/a/b/actions/runs/1'), {
    kind: 'repo',
    repo: 'a/b',
    tab: 'actions',
  });
  assert.deepEqual(routeForUrl('https://github.com/a/b/releases/tag/v1'), {
    kind: 'repo',
    repo: 'a/b',
    tab: 'releases',
  });
  assert.deepEqual(routeForUrl('https://github.com/a/b/issues'), { kind: 'repo', repo: 'a/b', tab: 'issues' });
  assert.deepEqual(routeForUrl('https://github.com/a/b/issues/new'), { kind: 'new-issue', repo: 'a/b' });
});

test('a compare link opens a new pull request from its head', () => {
  assert.deepEqual(routeForUrl('https://github.com/a/b/compare/main...fix-typo'), {
    kind: 'new-pull',
    repo: 'a/b',
    head: 'fix-typo',
  });
  assert.deepEqual(routeForUrl('https://github.com/a/b/compare/fix'), {
    kind: 'new-pull',
    repo: 'a/b',
    head: 'fix',
  });
});


test('brief paging and direct entry use the same PR route with only identity stored', () => {
  const pr = { repo: 'a/b', number: 7, body: 'stale preview', canUpdate: true };
  const next = { repo: 'c/d', number: 8 };
  assert.deepEqual(pullRoute(pr), routeForUrl('https://github.com/a/b/pull/7'));
  assert.deepEqual(pullRoute(pr, [pr, next]), {
    kind: 'pull', repo: 'a/b', number: 7,
    sequence: [{ repo: 'a/b', number: 7 }, next],
  });
});

test('comment links select talk and file links select files on the same PR page', () => {
  for (const hash of ['issuecomment-123', 'discussion_r456', 'pullrequestreview-789']) {
    assert.deepEqual(routeForUrl(`https://github.com/a/b/pull/7#${hash}`), {
      ...pullRoute({ repo: 'a/b', number: 7 }), tab: 'talk',
    });
  }
  assert.deepEqual(routeForUrl('https://github.com/a/b/pull/7/files'), {
    ...pullRoute({ repo: 'a/b', number: 7 }), tab: 'diff',
  });
});
