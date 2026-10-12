import { z } from 'zod';

/**
 * GitHub's eight reactions, written as words.
 *
 * The site draws them as coloured emoji, and the app has one ink: a heart in
 * red beside a diff in sage would be the loudest thing on the page and mean
 * the least. So each one is a short word in the mono face, and the count is
 * beside it the way every other count in the app is.
 */
export const REACTIONS = [
  ['THUMBS_UP', '+1'],
  ['THUMBS_DOWN', '-1'],
  ['LAUGH', 'laugh'],
  ['HOORAY', 'hooray'],
  ['CONFUSED', 'confused'],
  ['HEART', 'heart'],
  ['ROCKET', 'rocket'],
  ['EYES', 'eyes'],
] as const;

export type ReactionContent = (typeof REACTIONS)[number][0];

export interface Reaction {
  content: ReactionContent;
  count: number;
  /** Whether the account in use is one of them. */
  mine: boolean;
}

/** The fragment every reactable object asks for. */
export const REACTION_FIELDS = 'reactionGroups { content viewerHasReacted reactors { totalCount } }';

export const reactionGroupsSchema = z
  .array(
    z.object({
      content: z.string(),
      viewerHasReacted: z.boolean(),
      reactors: z.object({ totalCount: z.number().int().nonnegative() }),
    }),
  )
  .nullable()
  .optional();

/** GitHub's groups, in the app's order, the empty ones dropped. */
export function toReactions(groups: z.infer<typeof reactionGroupsSchema>): Reaction[] {
  const byContent = new Map((groups ?? []).map((group) => [group.content, group]));
  return REACTIONS.flatMap(([content]) => {
    const group = byContent.get(content);
    if (!group || (group.reactors.totalCount === 0 && !group.viewerHasReacted)) return [];
    return [{ content, count: group.reactors.totalCount, mine: group.viewerHasReacted }];
  });
}

export function reactionWord(content: ReactionContent): string {
  return REACTIONS.find(([key]) => key === content)?.[1] ?? content.toLowerCase();
}

/**
 * The list after pressing one reaction: yours added or taken away, the count
 * moved by one, a reaction nobody has any more dropped. What the screen shows
 * while the request is out, and what it keeps if the reload is slow.
 */
export function toggleReaction(reactions: Reaction[], content: ReactionContent): Reaction[] {
  const existing = reactions.find((reaction) => reaction.content === content);
  if (!existing) {
    const added = [...reactions, { content, count: 1, mine: true }];
    const order = REACTIONS.map(([key]) => key as ReactionContent);
    return added.sort((a, b) => order.indexOf(a.content) - order.indexOf(b.content));
  }
  return reactions.flatMap((reaction) => {
    if (reaction.content !== content) return [reaction];
    const count = Math.max(0, reaction.count + (reaction.mine ? -1 : 1));
    return count === 0 ? [] : [{ ...reaction, count, mine: !reaction.mine }];
  });
}
