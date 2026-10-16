import { z } from 'zod';

/** The identity shared by lists, links, notifications and the detail loader. */
export interface PullRef {
  repo: string;
  number: number;
}

/** Fields shared by the activity sample and an opened PR. Keep one contract. */
export const PULL_SUMMARY_FIELDS = /* GraphQL */ `
  number title url body state isDraft createdAt mergedAt
  additions deletions changedFiles reviewDecision
  labels(first: 20) { nodes { name color } }
  commits { totalCount }
`;

export const pullSummarySchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  body: z.string(),
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  isDraft: z.boolean(),
  createdAt: z.string(),
  mergedAt: z.string().nullable(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  reviewDecision: z.string().nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string(), color: z.string() })) }).nullable(),
  commits: z.object({ totalCount: z.number().int().nonnegative() }),
});

export interface PullSummary extends PullRef {
  title: string;
  url: string;
  body: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  reviewDecision: string | null;
  labels: { name: string; color: string }[];
}

export function toPullSummary(pr: z.infer<typeof pullSummarySchema>, repo: string): PullSummary {
  return {
    repo, number: pr.number, title: pr.title, url: pr.url, body: pr.body,
    state: pr.state, isDraft: pr.isDraft, createdAt: pr.createdAt, mergedAt: pr.mergedAt,
    additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles,
    commits: pr.commits.totalCount, reviewDecision: pr.reviewDecision, labels: pr.labels?.nodes ?? [],
  };
}
