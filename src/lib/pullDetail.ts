import { z } from 'zod';

import { executeQuery } from './github';
import { REACTION_FIELDS, reactionGroupsSchema, toReactions, type Reaction } from './reactions';
import { rest } from './rest';

/**
 * One pull request, opened.
 *
 * Everything else in the app lists pull requests; this reads one — the
 * description, the conversation and the actual diff. Two requests, because
 * the two halves live in different APIs:
 *
 *  - GraphQL for the object and its talk. Review *threads* matter as much as
 *    top-level comments: the line someone objected to is the review.
 *  - REST for the files, because GraphQL's `files` connection carries paths
 *    and counts but no patch text, and a diff without the lines is a table.
 *
 * Both are capped. A pull request can have a thousand changed files and
 * nobody reads a thousand files on a phone.
 */

const FILE_LIMIT = 20;
const COMMENT_LIMIT = 25;
const THREAD_LIMIT = 15;
/** Lines of any one file's patch that get drawn before it is cut off. */
const PATCH_LINES = 260;

export type CommentKind = 'comment' | 'review' | 'thread';

export interface PullComment {
  id: string;
  kind: CommentKind;
  author: string;
  /** Raw markdown — the screen renders it. */
  body: string;
  createdAt: string;
  url: string;
  /** APPROVED · CHANGES_REQUESTED · COMMENTED, on reviews only. */
  state?: string;
  /** The file a review thread is anchored to. */
  path?: string;
  /** The few lines of diff the thread is about. */
  diffHunk?: string;
  /** Threads only: whether the conversation was settled. */
  resolved?: boolean;
  /** Replies inside a review thread, oldest first. */
  replies?: PullComment[];
  /**
   * The comment's own node — what a reaction, an edit or a delete is aimed
   * at. For a thread, its first comment; `id` is the thread.
   */
  subjectId: string;
  /** Which mutation edits it: top-level talk is an issue comment, a thread is a review comment. */
  editKind: 'issue' | 'review' | null;
  canEdit: boolean;
  canDelete: boolean;
  reactions: Reaction[];
  /** Threads only. */
  canResolve?: boolean;
  canUnresolve?: boolean;
  canReply?: boolean;
}

export type DiffKind = 'add' | 'del' | 'context' | 'meta';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
  /** True when the patch was longer than `PATCH_LINES`. */
  truncated: boolean;
  /** Binary files and very large diffs come back from GitHub with no patch. */
  hasPatch: boolean;
}

export interface PullDetailFull {
  /** Node id — what a reply or a review is attached to. */
  id: string;
  /** The head commit: where line comments land and where checks ran. */
  headSha: string;
  /** GitHub will not let you approve your own pull request. */
  viewerIsAuthor: boolean;
  number: number;
  title: string;
  url: string;
  body: string;
  repo: string;
  author: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  reviewDecision: string | null;
  labels: { name: string; color: string }[];
  assignees: string[];
  /** People asked for a review who have not given one yet. */
  reviewers: string[];
  milestone: { number: number; title: string } | null;
  /** MERGEABLE · CONFLICTING · UNKNOWN (GitHub is still working it out). */
  mergeable: string;
  /** CLEAN · BEHIND · BLOCKED · DIRTY · UNSTABLE · DRAFT · HAS_HOOKS · UNKNOWN. */
  mergeState: string;
  /** The ways this repository allows a merge, in GitHub's order. */
  mergeMethods: ('MERGE' | 'SQUASH' | 'REBASE')[];
  autoMergeAllowed: boolean;
  autoMergeOn: boolean;
  /** Title, body, labels, state: what `viewerCanUpdate` guards. */
  canUpdate: boolean;
  canUpdateBranch: boolean;
  /** ADMIN · MAINTAIN · WRITE · TRIAGE · READ. */
  permission: string | null;
  subscription: string | null;
  locked: boolean;
  /** Where the head branch lives, and whether it still does. */
  headRepo: string | null;
  headRefExists: boolean;
  reactions: Reaction[];
  comments: PullComment[];
  files: DiffFile[];
  /** True when the file list was capped at `FILE_LIMIT`. */
  moreFiles: number;
}

const actor = z.object({ login: z.string() }).nullable();

const commentNode = z.object({
  id: z.string(),
  author: actor,
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
  viewerCanUpdate: z.boolean().optional(),
  viewerCanDelete: z.boolean().optional(),
  reactionGroups: reactionGroupsSchema,
});

const threadCommentNode = commentNode.extend({
  path: z.string().nullable(),
  diffHunk: z.string().nullable(),
});

const pullSchema = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          id: z.string(),
          headRefOid: z.string(),
          viewerDidAuthor: z.boolean(),
          number: z.number().int(),
          title: z.string(),
          url: z.string(),
          body: z.string(),
          state: z.string(),
          isDraft: z.boolean(),
          createdAt: z.string(),
          mergedAt: z.string().nullable(),
          baseRefName: z.string(),
          headRefName: z.string(),
          additions: z.number().int().nonnegative(),
          deletions: z.number().int().nonnegative(),
          changedFiles: z.number().int().nonnegative(),
          reviewDecision: z.string().nullable(),
          author: actor,
          labels: z
            .object({ nodes: z.array(z.object({ name: z.string(), color: z.string() })) })
            .nullable(),
          assignees: z.object({ nodes: z.array(z.object({ login: z.string() })) }),
          reviewRequests: z
            .object({
              nodes: z.array(
                z.object({
                  requestedReviewer: z
                    .object({ login: z.string().optional(), slug: z.string().optional() })
                    .nullable(),
                }),
              ),
            })
            .nullable(),
          milestone: z.object({ number: z.number().int(), title: z.string() }).nullable(),
          mergeable: z.string(),
          mergeStateStatus: z.string(),
          viewerCanUpdate: z.boolean(),
          viewerCanUpdateBranch: z.boolean(),
          viewerSubscription: z.string().nullable(),
          locked: z.boolean(),
          autoMergeRequest: z.object({ enabledAt: z.string().nullable() }).nullable(),
          headRepository: z.object({ nameWithOwner: z.string() }).nullable(),
          headRef: z.object({ id: z.string() }).nullable(),
          reactionGroups: reactionGroupsSchema,
          repository: z.object({
            mergeCommitAllowed: z.boolean(),
            squashMergeAllowed: z.boolean(),
            rebaseMergeAllowed: z.boolean(),
            autoMergeAllowed: z.boolean(),
            viewerPermission: z.string().nullable(),
          }),
          commits: z.object({ totalCount: z.number().int().nonnegative() }),
          comments: z.object({ nodes: z.array(commentNode) }),
          reviews: z.object({
            nodes: z.array(
              commentNode.extend({ state: z.string(), submittedAt: z.string().nullable() }),
            ),
          }),
          reviewThreads: z.object({
            nodes: z.array(
              z.object({
                id: z.string(),
                isResolved: z.boolean(),
                viewerCanResolve: z.boolean(),
                viewerCanUnresolve: z.boolean(),
                viewerCanReply: z.boolean(),
                path: z.string().nullable(),
                comments: z.object({ nodes: z.array(threadCommentNode) }),
              }),
            ),
          }),
        })
        .nullable(),
    })
    .nullable(),
});

const filesSchema = z.array(
  z.object({
    filename: z.string(),
    status: z.string(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    patch: z.string().optional(),
  }),
);

function query(owner: string, name: string, number: number): string {
  return /* GraphQL */ `
    query Pull {
      repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
        pullRequest(number: ${number}) {
          id
          headRefOid
          viewerDidAuthor
          number
          title
          url
          body
          state
          isDraft
          createdAt
          mergedAt
          baseRefName
          headRefName
          additions
          deletions
          changedFiles
          reviewDecision
          author { login }
          labels(first: 20) { nodes { name color } }
          assignees(first: 10) { nodes { login } }
          reviewRequests(first: 10) {
            nodes { requestedReviewer { ... on User { login } ... on Team { slug } } }
          }
          milestone { number title }
          mergeable
          mergeStateStatus
          viewerCanUpdate
          viewerCanUpdateBranch
          viewerSubscription
          locked
          autoMergeRequest { enabledAt }
          headRepository { nameWithOwner }
          headRef { id }
          ${REACTION_FIELDS}
          repository {
            mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed viewerPermission
          }
          commits { totalCount }
          comments(last: ${COMMENT_LIMIT}) {
            nodes {
              id author { login } body createdAt url viewerCanUpdate viewerCanDelete
              ${REACTION_FIELDS}
            }
          }
          reviews(last: ${COMMENT_LIMIT}) {
            nodes { id author { login } body createdAt url state submittedAt ${REACTION_FIELDS} }
          }
          reviewThreads(last: ${THREAD_LIMIT}) {
            nodes {
              id
              isResolved
              viewerCanResolve
              viewerCanUnresolve
              viewerCanReply
              path
              comments(first: 6) {
                nodes {
                  id author { login } body createdAt url path diffHunk viewerCanUpdate viewerCanDelete
                  ${REACTION_FIELDS}
                }
              }
            }
          }
        }
      }
    }
  `;
}

/**
 * The patch text GitHub sends for one file, turned into numbered lines.
 *
 * A unified diff carries its line numbers only in the `@@` headers; every
 * line after one is implicitly the next. Recovering them is the difference
 * between a diff you can talk about and a wall of green and red.
 */
export function parsePatch(patch: string): { lines: DiffLine[]; truncated: boolean } {
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let truncated = false;

  const rows = patch.split('\n');
  // A patch that ends in a newline splits to a trailing empty string, which
  // would otherwise be drawn as one blank context line at the end of every
  // file. Git writes a genuine blank context line as a single space.
  if (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();

  for (const raw of rows) {
    if (out.length >= PATCH_LINES) {
      truncated = true;
      break;
    }

    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      out.push({
        kind: 'meta',
        // The trailing text on a hunk header is the enclosing function, which
        // is the single most useful thing on the line.
        text: header[3].trim() || `line ${newLine}`,
        oldLine: null,
        newLine: null,
      });
      continue;
    }

    if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), oldLine: null, newLine });
      newLine += 1;
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), oldLine, newLine: null });
      oldLine += 1;
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" — real, and never worth a row.
      continue;
    } else {
      out.push({ kind: 'context', text: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return { lines: out, truncated };
}

async function fetchFiles(
  token: string,
  repo: string,
  number: number,
  signal?: AbortSignal,
): Promise<DiffFile[]> {
  const files = await rest(token, `/repos/${repo}/pulls/${number}/files?per_page=${FILE_LIMIT}`, {
    schema: filesSchema,
    signal,
  });
  return files.map((file) => {
    const { lines, truncated } = file.patch
      ? parsePatch(file.patch)
      : { lines: [], truncated: false };
    return {
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      lines,
      truncated,
      hasPatch: Boolean(file.patch),
    };
  });
}

/**
 * Everything one pull request has to say. Only the GraphQL half can fail it:
 * the file patches are optional.
 */
export async function fetchPullDetail(
  token: string,
  repo: string,
  number: number,
  signal?: AbortSignal,
): Promise<PullDetailFull | null> {
  const [owner, name] = repo.split('/');
  if (!owner || !name) return null;

  const [data, files] = await Promise.all([
    executeQuery(token, query(owner, name, number), pullSchema, signal),
    // The diff is the optional half: a token that can read the object but not
    // the contents still gets a readable conversation.
    fetchFiles(token, repo, number, signal).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return [] as DiffFile[];
    }),
  ]);

  const pr = data.repository?.pullRequest;
  if (!pr) return null;

  const comments: PullComment[] = [
    ...pr.comments.nodes.map((node) => ({
      id: node.id,
      kind: 'comment' as const,
      author: node.author?.login ?? 'ghost',
      body: node.body,
      createdAt: node.createdAt,
      url: node.url,
      subjectId: node.id,
      editKind: 'issue' as const,
      canEdit: node.viewerCanUpdate ?? false,
      canDelete: node.viewerCanDelete ?? false,
      reactions: toReactions(node.reactionGroups),
    })),
    // A review with an empty body is just a state change; the chip for it is
    // already on the header, so an empty card would say nothing twice.
    ...pr.reviews.nodes
      .filter((node) => node.body.trim().length > 0 || node.state === 'CHANGES_REQUESTED')
      .map((node) => ({
        id: node.id,
        kind: 'review' as const,
        author: node.author?.login ?? 'ghost',
        body: node.body,
        createdAt: node.submittedAt ?? node.createdAt,
        url: node.url,
        state: node.state,
        subjectId: node.id,
        editKind: null,
        canEdit: false,
        canDelete: false,
        reactions: toReactions(node.reactionGroups),
      })),
    ...pr.reviewThreads.nodes.flatMap((thread) => {
      const [head, ...rest] = thread.comments.nodes;
      if (!head) return [];
      return [
        {
          id: thread.id,
          kind: 'thread' as const,
          author: head.author?.login ?? 'ghost',
          body: head.body,
          createdAt: head.createdAt,
          url: head.url,
          path: thread.path ?? head.path ?? undefined,
          diffHunk: head.diffHunk ?? undefined,
          resolved: thread.isResolved,
          subjectId: head.id,
          editKind: 'review' as const,
          canEdit: head.viewerCanUpdate ?? false,
          canDelete: head.viewerCanDelete ?? false,
          reactions: toReactions(head.reactionGroups),
          canResolve: thread.viewerCanResolve,
          canUnresolve: thread.viewerCanUnresolve,
          canReply: thread.viewerCanReply,
          replies: rest.map((reply) => ({
            id: reply.id,
            kind: 'thread' as const,
            author: reply.author?.login ?? 'ghost',
            body: reply.body,
            createdAt: reply.createdAt,
            url: reply.url,
            subjectId: reply.id,
            editKind: 'review' as const,
            canEdit: reply.viewerCanUpdate ?? false,
            canDelete: reply.viewerCanDelete ?? false,
            reactions: toReactions(reply.reactionGroups),
          })),
        },
      ];
    }),
  ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  return {
    id: pr.id,
    headSha: pr.headRefOid,
    viewerIsAuthor: pr.viewerDidAuthor,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    body: pr.body,
    repo,
    author: pr.author?.login ?? 'ghost',
    state:
      pr.state === 'MERGED' ? 'MERGED' : pr.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    isDraft: pr.isDraft,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commits: pr.commits.totalCount,
    reviewDecision: pr.reviewDecision,
    labels: pr.labels?.nodes ?? [],
    assignees: pr.assignees.nodes.map((node) => node.login),
    reviewers: (pr.reviewRequests?.nodes ?? []).flatMap((node) => {
      const who = node.requestedReviewer?.login ?? node.requestedReviewer?.slug;
      return who ? [who] : [];
    }),
    milestone: pr.milestone,
    mergeable: pr.mergeable,
    mergeState: pr.mergeStateStatus,
    mergeMethods: [
      ...(pr.repository.mergeCommitAllowed ? (['MERGE'] as const) : []),
      ...(pr.repository.squashMergeAllowed ? (['SQUASH'] as const) : []),
      ...(pr.repository.rebaseMergeAllowed ? (['REBASE'] as const) : []),
    ],
    autoMergeAllowed: pr.repository.autoMergeAllowed,
    autoMergeOn: pr.autoMergeRequest != null,
    canUpdate: pr.viewerCanUpdate,
    canUpdateBranch: pr.viewerCanUpdateBranch,
    permission: pr.repository.viewerPermission,
    subscription: pr.viewerSubscription,
    locked: pr.locked,
    headRepo: pr.headRepository?.nameWithOwner ?? null,
    headRefExists: pr.headRef != null,
    reactions: toReactions(pr.reactionGroups),
    comments,
    files,
    moreFiles: Math.max(0, pr.changedFiles - files.length),
  };
}
