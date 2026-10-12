import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reactionWord, toggleReaction, toReactions } from './reactions';

test('groups come back in the app order, empty ones dropped', () => {
  const reactions = toReactions([
    { content: 'HEART', viewerHasReacted: false, reactors: { totalCount: 2 } },
    { content: 'EYES', viewerHasReacted: false, reactors: { totalCount: 0 } },
    { content: 'THUMBS_UP', viewerHasReacted: true, reactors: { totalCount: 5 } },
  ]);
  assert.deepEqual(reactions, [
    { content: 'THUMBS_UP', count: 5, mine: true },
    { content: 'HEART', count: 2, mine: false },
  ]);
  assert.deepEqual(toReactions(null), []);
});

test('pressing a reaction adds yours, pressing it again takes it away', () => {
  const start = [{ content: 'HEART' as const, count: 2, mine: false }];
  const added = toggleReaction(start, 'HEART');
  assert.deepEqual(added, [{ content: 'HEART', count: 3, mine: true }]);
  assert.deepEqual(toggleReaction(added, 'HEART'), start);
});

test('a new reaction is slotted into order, and the last one out drops it', () => {
  const start = [{ content: 'HEART' as const, count: 1, mine: false }];
  const added = toggleReaction(start, 'THUMBS_UP');
  assert.deepEqual(
    added.map((reaction) => reaction.content),
    ['THUMBS_UP', 'HEART'],
  );
  assert.deepEqual(toggleReaction(added, 'THUMBS_UP'), start);
});

test('reactions are words', () => {
  assert.equal(reactionWord('THUMBS_UP'), '+1');
  assert.equal(reactionWord('ROCKET'), 'rocket');
});
