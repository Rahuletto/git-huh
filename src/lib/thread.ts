import { z } from 'zod';

import { executeQuery } from './github';
import { REACTION_FIELDS, reactionGroupsSchema, toReactions, type Reaction } from './reactions';

/**
 * An issue or a discussion, read in full: the opening post, the replies, and
 * for a discussion the replies to replies. It is the same shape either way,
 * which is why one screen draws both — and why an issue in the inbox no
 * longer leaves for the browser.
 */

export interface ThreadComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string;
  /** Discussions only: the reply marked as the answer. */
  isAnswer?: boolean;
  replies: ThreadComment[];
  canEdit: boolean;
  canDelete: boolean;
  reactions: Reaction[];
  /** Discussions only. */
  upvotes?: number;
  upvoted?: boolean;
  canUpvote?: boolean;
  canMarkAnswer?: boolean;
  canUnmarkAnswer?: boolean;
}

export interface Thread {
  type: 'issue' | 'discussion';
  /** Node id — what a reply is attached to. */
  id: string;
  number: number;
  repo: string;
  title: string;
  url: string;
  body: string;
  /** OPEN · CLOSED for issues; ANSWERED · OPEN for discussions. */
  state: string;
  author: string;
  createdAt: string;
  labels: { name: string; color: string }[];
  category: string | null;
  comments: ThreadComment[];
  /** Replies GitHub has that were not fetched. */
  moreComments: number;
  assignees: string[];
  milestone: { number: number; title: string } | null;
  locked: boolean;
  /** SUBSCRIBED · UNSUBSCRIBED · IGNORED. */
  subscription: string | null;
  canUpdate: boolean;
  /** Issues only. */
  pinned: boolean;
  /** COMPLETED · NOT_PLANNED · REOPENED, on a closed issue. */
  stateReason: string | null;
  reactions: Reaction[];
  /** Discussions only. */
  closed: boolean;
  upvotes: number;
  upvoted: boolean;
  canUpvote: boolean;
}

const COMMENTS = 40;

const actor = z.object({ login: z.string() }).nullable();
const comment = z.object({
  id: z.string(),
  author: actor,
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
  viewerCanUpdate: z.boolean(),
  viewerCanDelete: z.boolean(),
  reactionGroups: reactionGroupsSchema,
  upvoteCount: z.number().optional(),
  viewerHasUpvoted: z.boolean().optional(),
  viewerCanUpvote: z.boolean().optional(),
  viewerCanMarkAsAnswer: z.boolean().optional(),
  viewerCanUnmarkAsAnswer: z.boolean().optional(),
});

const COMMENT_FIELDS = `id author { login } body createdAt url viewerCanUpdate viewerCanDelete ${REACTION_FIELDS}`;
const DISCUSSION_COMMENT_FIELDS = `${COMMENT_FIELDS}
  upvoteCount viewerHasUpvoted viewerCanUpvote viewerCanMarkAsAnswer viewerCanUnmarkAsAnswer`;

const people = z.object({ nodes: z.array(z.object({ login: z.string() })) });
const milestone = z.object({ number: z.number().int(), title: z.string() }).nullable();

const issueSchema = z.object({
  repository: z
    .object({
      issue: z
        .object({
          id: z.string(),
          number: z.number().int(),
          title: z.string(),
          url: z.string(),
          body: z.string(),
          state: z.string(),
          createdAt: z.string(),
          author: actor,
          labels: z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string() })) }).nullable(),
          comments: z.object({ totalCount: z.number(), nodes: z.array(comment) }),
          assignees: people,
          milestone,
          locked: z.boolean(),
          viewerSubscription: z.string().nullable(),
          viewerCanUpdate: z.boolean(),
          isPinned: z.boolean().nullable(),
          stateReason: z.string().nullable(),
          reactionGroups: reactionGroupsSchema,
        })
        .nullable(),
    })
    .nullable(),
});

const discussionSchema = z.object({
  repository: z
    .object({
      discussion: z
        .object({
          id: z.string(),
          number: z.number().int(),
          title: z.string(),
          url: z.string(),
          body: z.string(),
          createdAt: z.string(),
          author: actor,
          isAnswered: z.boolean().nullable(),
          answer: z.object({ id: z.string() }).nullable(),
          category: z.object({ name: z.string() }),
          closed: z.boolean(),
          locked: z.boolean(),
          viewerSubscription: z.string().nullable(),
          viewerCanUpdate: z.boolean(),
          upvoteCount: z.number(),
          viewerHasUpvoted: z.boolean(),
          viewerCanUpvote: z.boolean(),
          reactionGroups: reactionGroupsSchema,
          comments: z.object({
            totalCount: z.number(),
            nodes: z.array(comment.extend({ replies: z.object({ nodes: z.array(comment) }) })),
          }),
        })
        .nullable(),
    })
    .nullable(),
});

function toComment(node: z.infer<typeof comment>): ThreadComment {
  return {
    id: node.id,
    author: node.author?.login ?? 'ghost',
    body: node.body,
    createdAt: node.createdAt,
    url: node.url,
    replies: [],
    canEdit: node.viewerCanUpdate,
    canDelete: node.viewerCanDelete,
    reactions: toReactions(node.reactionGroups),
    upvotes: node.upvoteCount,
    upvoted: node.viewerHasUpvoted,
    canUpvote: node.viewerCanUpvote,
    canMarkAnswer: node.viewerCanMarkAsAnswer,
    canUnmarkAnswer: node.viewerCanUnmarkAsAnswer,
  };
}

export async function fetchThread(
  token: string,
  repo: string,
  number: number,
  type: 'issue' | 'discussion',
  signal?: AbortSignal,
): Promise<Thread | null> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) return null;
  const where = `repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)})`;

  if (type === 'issue') {
    const data = await executeQuery(
      token,
      /* GraphQL */ `
        query Issue {
          ${where} {
            issue(number: ${number}) {
              id number title url body state createdAt
              author { login }
              labels(first: 20) { nodes { name color } }
              assignees(first: 10) { nodes { login } }
              milestone { number title }
              locked viewerSubscription viewerCanUpdate isPinned stateReason
              ${REACTION_FIELDS}
              comments(last: ${COMMENTS}) {
                totalCount
                nodes { ${COMMENT_FIELDS} }
              }
            }
          }
        }
      `,
      issueSchema,
      signal,
    );
    const issue = data.repository?.issue;
    if (!issue) return null;
    return {
      type,
      id: issue.id,
      number: issue.number,
      repo,
      title: issue.title,
      url: issue.url,
      body: issue.body,
      state: issue.state,
      author: issue.author?.login ?? 'ghost',
      createdAt: issue.createdAt,
      labels: issue.labels?.nodes ?? [],
      category: null,
      comments: issue.comments.nodes.map(toComment),
      moreComments: Math.max(0, issue.comments.totalCount - issue.comments.nodes.length),
      assignees: issue.assignees.nodes.map((node) => node.login),
      milestone: issue.milestone,
      locked: issue.locked,
      subscription: issue.viewerSubscription,
      canUpdate: issue.viewerCanUpdate,
      pinned: issue.isPinned ?? false,
      stateReason: issue.stateReason,
      reactions: toReactions(issue.reactionGroups),
      closed: issue.state === 'CLOSED',
      upvotes: 0,
      upvoted: false,
      canUpvote: false,
    };
  }

  const data = await executeQuery(
    token,
    /* GraphQL */ `
      query Discussion {
        ${where} {
          discussion(number: ${number}) {
            id number title url body createdAt isAnswered
            author { login }
            answer { id }
            category { name }
            closed locked viewerSubscription viewerCanUpdate upvoteCount viewerHasUpvoted viewerCanUpvote
            ${REACTION_FIELDS}
            comments(first: ${COMMENTS}) {
              totalCount
              nodes {
                ${DISCUSSION_COMMENT_FIELDS}
                replies(first: 10) { nodes { ${DISCUSSION_COMMENT_FIELDS} } }
              }
            }
          }
        }
      }
    `,
    discussionSchema,
    signal,
  );
  const discussion = data.repository?.discussion;
  if (!discussion) return null;
  return {
    type,
    id: discussion.id,
    number: discussion.number,
    repo,
    title: discussion.title,
    url: discussion.url,
    body: discussion.body,
    state: discussion.closed ? 'CLOSED' : discussion.isAnswered ? 'ANSWERED' : 'OPEN',
    author: discussion.author?.login ?? 'ghost',
    createdAt: discussion.createdAt,
    labels: [],
    category: discussion.category.name,
    comments: discussion.comments.nodes.map((node) => ({
      ...toComment(node),
      isAnswer: discussion.answer?.id === node.id,
      replies: node.replies.nodes.map(toComment),
    })),
    moreComments: Math.max(0, discussion.comments.totalCount - discussion.comments.nodes.length),
    assignees: [],
    milestone: null,
    locked: discussion.locked,
    subscription: discussion.viewerSubscription,
    canUpdate: discussion.viewerCanUpdate,
    pinned: false,
    stateReason: null,
    reactions: toReactions(discussion.reactionGroups),
    closed: discussion.closed,
    upvotes: discussion.upvoteCount,
    upvoted: discussion.viewerHasUpvoted,
    canUpvote: discussion.viewerCanUpvote,
  };
}
