import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { fetchPullDetail, parsePatch } from './pullDetail';

test('line numbers are recovered from the hunk headers', () => {
  const patch = [
    '@@ -1,3 +1,4 @@ function main()',
    ' keep',
    '-old',
    '+new',
    '+added',
    ' tail',
    '\\ No newline at end of file',
    '',
  ].join('\n');

  assert.deepEqual(parsePatch(patch), {
    truncated: false,
    lines: [
      { kind: 'meta', text: 'function main()', oldLine: null, newLine: null },
      { kind: 'context', text: 'keep', oldLine: 1, newLine: 1 },
      { kind: 'del', text: 'old', oldLine: 2, newLine: null },
      { kind: 'add', text: 'new', oldLine: null, newLine: 2 },
      { kind: 'add', text: 'added', oldLine: null, newLine: 3 },
      { kind: 'context', text: 'tail', oldLine: 3, newLine: 4 },
    ],
  });
});

test('a hunk header with no function names its line instead', () => {
  const [meta] = parsePatch('@@ -10 +12 @@\n x').lines;
  assert.equal(meta.text, 'line 12');
});

test('a second hunk restarts the count', () => {
  const { lines } = parsePatch('@@ -1 +1 @@\n a\n@@ -40,2 +41,2 @@\n b');
  assert.deepEqual(
    lines.filter((line) => line.kind === 'context').map((line) => [line.oldLine, line.newLine]),
    [
      [1, 1],
      [40, 41],
    ],
  );
});

test('a very long patch is cut and says so', () => {
  const body = Array.from({ length: 5000 }, (_, i) => `+line ${i}`).join('\n');
  const { lines, truncated } = parsePatch(`@@ -0,0 +1,5000 @@\n${body}`);
  assert.equal(truncated, true);
  assert.ok(lines.length < 5000);
});

// The endpoint boundary matters here: a preview succeeding must not depend
// on whether GitHub also allows management fields, conversation or patches.
const core = {
  id: 'PR_1', number: 7, title: 'Readable PR', url: 'https://github.com/a/b/pull/7',
  body: 'The whole description', state: 'OPEN', isDraft: false,
  createdAt: '2026-10-15T00:00:00Z', mergedAt: null,
  additions: 3, deletions: 1, changedFiles: 1, reviewDecision: null,
  labels: { nodes: [] }, commits: { totalCount: 1 }, headRefOid: 'abc123',
  viewerDidAuthor: true, author: { login: 'author' },
  baseRefName: 'main', headRefName: 'fix', locked: false, reactionGroups: [],
};
const details = {
  assignees: { nodes: [] }, reviewRequests: { nodes: [{ requestedReviewer: { slug: 'reviewers' } }] },
  milestone: null, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  viewerCanUpdate: true, viewerCanUpdateBranch: true, autoMergeRequest: null,
  headRepository: { nameWithOwner: 'a/b' }, headRef: { id: 'ref' },
  repository: { mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false,
    autoMergeAllowed: true, viewerPermission: 'WRITE' },
};
const conversation = {
  comments: { nodes: [{ id: 'C_1', author: { login: 'reviewer' }, body: 'Still readable',
    createdAt: '2026-10-15T01:00:00Z', url: 'https://github.com/a/b/pull/7#issuecomment-1' }] },
  reviews: { nodes: [] }, reviewThreads: { nodes: [] },
};

function respondToPulls(t: TestContext, overrides: Record<string, () => Response> = {}) {
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const request = input.endsWith('/graphql') ? JSON.parse(String(init?.body)) : null;
    const operation = request?.query.match(/query (\w+)/)?.[1] ?? 'files';
    if (request) assert.deepEqual(request.variables, { owner: 'a', name: 'b', number: 7 });
    if (overrides[operation]) return overrides[operation]();
    if (operation === 'files') return Response.json([{ filename: 'file.ts', status: 'modified',
      additions: 3, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' }]);
    const data = operation === 'Pull' ? core : operation === 'PullDetails' ? details : conversation;
    return Response.json({ data: { repository: { pullRequest: data } } });
  });
}

const forbidden = () => Response.json({
  data: { repository: { pullRequest: null } },
  errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token',
    path: ['repository', 'pullRequest', 'reviewRequests', 'nodes', 0, 'requestedReviewer'] }],
});

test('one detail loader returns the description, conversation, controls and diff', async (t) => {
  respondToPulls(t);
  const pull = await fetchPullDetail('test-token', 'a/b', 7);
  assert.ok(pull);
  assert.equal(pull.body, core.body);
  assert.equal(pull.comments[0].body, 'Still readable');
  assert.deepEqual(pull.reviewers, ['reviewers']);
  assert.deepEqual(pull.mergeMethods, ['MERGE', 'SQUASH']);
  assert.equal(pull.files[0].lines[2].text, 'new');
  assert.deepEqual(pull.unavailable, {});
});

test('a forbidden team reviewer does not hide the PR, comments or files', async (t) => {
  respondToPulls(t, { PullDetails: forbidden });
  const pull = await fetchPullDetail('test-token', 'a/b', 7);
  assert.ok(pull);
  assert.equal(pull.body, core.body);
  assert.equal(pull.comments.length, 1);
  assert.equal(pull.files.length, 1);
  assert.equal(pull.unavailable.details?.kind, 'forbidden');
  assert.equal(pull.canUpdate, false);
  assert.equal(pull.permission, null);
  assert.deepEqual(pull.mergeMethods, []);
  assert.deepEqual(JSON.parse(JSON.stringify(pull)).unavailable, pull.unavailable);
});

test('denied conversation and patches are reported as unavailable, not empty', async (t) => {
  respondToPulls(t, { PullConversation: forbidden,
    files: () => Response.json({ message: 'Resource not accessible' }, { status: 403 }) });
  const pull = await fetchPullDetail('test-token', 'a/b', 7);
  assert.ok(pull);
  assert.equal(pull.title, core.title);
  assert.equal(pull.canUpdate, true);
  assert.equal(pull.unavailable.conversation?.kind, 'forbidden');
  assert.equal(pull.unavailable.files?.kind, 'forbidden');
});

test('a genuinely forbidden PR remains an error', async (t) => {
  respondToPulls(t, { Pull: forbidden });
  await assert.rejects(fetchPullDetail('test-token', 'a/b', 7), { kind: 'forbidden' });
});

test('expiry in any section is never hidden by readable content', async (t) => {
  respondToPulls(t, { files: () => Response.json({ message: 'Bad credentials' }, { status: 401 }) });
  await assert.rejects(fetchPullDetail('test-token', 'a/b', 7), { kind: 'invalid-token' });
});

test('cancelling a supplemental request still cancels the load', async (t) => {
  respondToPulls(t, { PullDetails: () => { throw new DOMException('Aborted', 'AbortError'); } });
  await assert.rejects(fetchPullDetail('test-token', 'a/b', 7), { name: 'AbortError' });
});

test('a missing core PR returns null', async (t) => {
  respondToPulls(t, { Pull: () => Response.json({ data: { repository: { pullRequest: null } } }) });
  assert.equal(await fetchPullDetail('test-token', 'a/b', 7), null);
});

test('a malformed supplemental response keeps core content and reports an API failure', async (t) => {
  respondToPulls(t, { PullDetails: () => Response.json({ data: { repository: { pullRequest: {} } } }) });
  const pull = await fetchPullDetail('test-token', 'a/b', 7);
  assert.equal(pull?.body, core.body);
  assert.equal(pull?.unavailable.details?.kind, 'api');
});
