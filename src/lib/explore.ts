import { z } from 'zod';

import { executeQuery } from './github';
import { rest } from './rest';

/**
 * The reads behind the app's writes and its ways out of your own work: the
 * lists a picker chooses from (labels, people who can be assigned,
 * milestones, branches, discussion categories), a repository's pull requests,
 * someone's profile, a search across GitHub, and gists.
 */

// --- pickers ----------------------------------------------------------------

export interface LabelOption {
  name: string;
  description: string;
}

const labelsSchema = z.array(z.object({ name: z.string(), description: z.string().nullable() }));

export async function listLabels(token: string, repo: string, signal?: AbortSignal): Promise<LabelOption[]> {
  const labels = await rest(token, `/repos/${repo}/labels?per_page=100`, { schema: labelsSchema, signal });
  return labels.map((label) => ({ name: label.name, description: label.description ?? '' }));
}

const usersSchema = z.array(z.object({ login: z.string() }));

/** Everyone who can be assigned here — which is also everyone who can review. */
export async function listAssignable(token: string, repo: string, signal?: AbortSignal): Promise<string[]> {
  const users = await rest(token, `/repos/${repo}/assignees?per_page=100`, { schema: usersSchema, signal });
  return users.map((user) => user.login);
}

export interface MilestoneOption {
  number: number;
  title: string;
  due: string | null;
}

const milestonesSchema = z.array(
  z.object({ number: z.number().int(), title: z.string(), due_on: z.string().nullable() }),
);

export async function listMilestones(
  token: string,
  repo: string,
  signal?: AbortSignal,
): Promise<MilestoneOption[]> {
  const milestones = await rest(token, `/repos/${repo}/milestones?state=open&per_page=50`, {
    schema: milestonesSchema,
    signal,
  });
  return milestones.map((milestone) => ({
    number: milestone.number,
    title: milestone.title,
    due: milestone.due_on,
  }));
}

export interface Branch {
  name: string;
  protected: boolean;
}

const branchesSchema = z.array(z.object({ name: z.string(), protected: z.boolean() }));

export async function listBranches(token: string, repo: string, signal?: AbortSignal): Promise<Branch[]> {
  return rest(token, `/repos/${repo}/branches?per_page=100`, { schema: branchesSchema, signal });
}

export interface Category {
  id: string;
  name: string;
  /** Q&A categories are the ones whose replies can be marked as the answer. */
  answerable: boolean;
}

const categoriesSchema = z.object({
  repository: z
    .object({
      discussionCategories: z.object({
        nodes: z.array(z.object({ id: z.string(), name: z.string(), isAnswerable: z.boolean() })),
      }),
    })
    .nullable(),
});

export async function listCategories(token: string, repo: string, signal?: AbortSignal): Promise<Category[]> {
  const [owner, name] = repo.split('/');
  const data = await executeQuery(
    token,
    /* GraphQL */ `
      query Categories {
        repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
          discussionCategories(first: 25) { nodes { id name isAnswerable } }
        }
      }
    `,
    categoriesSchema,
    signal,
  );
  return (data.repository?.discussionCategories.nodes ?? []).map((node) => ({
    id: node.id,
    name: node.name,
    answerable: node.isAnswerable,
  }));
}

// --- a repository's pull requests ---------------------------------------------

export interface PullRow {
  number: number;
  title: string;
  author: string;
  draft: boolean;
  merged: boolean;
  createdAt: string;
  head: string;
  base: string;
}

const pullsSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    user: z.object({ login: z.string() }).nullable(),
    draft: z.boolean().optional(),
    merged_at: z.string().nullable().optional(),
    created_at: z.string(),
    head: z.object({ label: z.string() }),
    base: z.object({ ref: z.string() }),
  }),
);

export async function listPulls(
  token: string,
  repo: string,
  state: 'open' | 'closed',
  signal?: AbortSignal,
): Promise<PullRow[]> {
  const pulls = await rest(token, `/repos/${repo}/pulls?state=${state}&per_page=30`, {
    schema: pullsSchema,
    signal,
  });
  return pulls.map((pull) => ({
    number: pull.number,
    title: pull.title,
    author: pull.user?.login ?? 'ghost',
    draft: pull.draft ?? false,
    merged: Boolean(pull.merged_at),
    createdAt: pull.created_at,
    head: pull.head.label,
    base: pull.base.ref,
  }));
}

// --- people -------------------------------------------------------------------

export interface ProfileRepo {
  nameWithOwner: string;
  description: string;
  stars: number;
  language: string | null;
  isPrivate: boolean;
}

export interface Profile {
  login: string;
  name: string;
  bio: string;
  company: string;
  location: string;
  website: string;
  createdAt: string;
  followers: number;
  following: number;
  /** null for an organisation, which cannot be followed this way. */
  viewerIsFollowing: boolean | null;
  isViewer: boolean;
  isOrganization: boolean;
  repos: ProfileRepo[];
}

const profileRepo = z.object({
  nameWithOwner: z.string(),
  description: z.string().nullable(),
  stargazerCount: z.number(),
  isPrivate: z.boolean(),
  primaryLanguage: z.object({ name: z.string() }).nullable(),
});

const reposField = z.object({ nodes: z.array(profileRepo) });

const profileSchema = z.object({
  user: z
    .object({
      login: z.string(),
      name: z.string().nullable(),
      bio: z.string().nullable(),
      company: z.string().nullable(),
      location: z.string().nullable(),
      websiteUrl: z.string().nullable(),
      createdAt: z.string(),
      followers: z.object({ totalCount: z.number() }),
      following: z.object({ totalCount: z.number() }),
      viewerIsFollowing: z.boolean(),
      isViewer: z.boolean(),
      repositories: reposField,
    })
    .nullable(),
  organization: z
    .object({
      login: z.string(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      location: z.string().nullable(),
      websiteUrl: z.string().nullable(),
      createdAt: z.string(),
      repositories: reposField,
    })
    .nullable(),
});

function toRepos(field: z.infer<typeof reposField>): ProfileRepo[] {
  return field.nodes.map((node) => ({
    nameWithOwner: node.nameWithOwner,
    description: node.description ?? '',
    stars: node.stargazerCount,
    language: node.primaryLanguage?.name ?? null,
    isPrivate: node.isPrivate,
  }));
}

/** A person or an organisation; GitHub answers whichever the login is. */
export async function fetchProfile(token: string, login: string, signal?: AbortSignal): Promise<Profile | null> {
  const name = JSON.stringify(login);
  const repos = `repositories(first: 20, orderBy: { field: PUSHED_AT, direction: DESC }) {
    nodes { nameWithOwner description stargazerCount isPrivate primaryLanguage { name } }
  }`;
  const data = await executeQuery(
    token,
    /* GraphQL */ `
      query Profile {
        user(login: ${name}) {
          login name bio company location websiteUrl createdAt viewerIsFollowing isViewer
          followers { totalCount } following { totalCount }
          ${repos}
        }
        organization(login: ${name}) {
          login name description location websiteUrl createdAt
          ${repos}
        }
      }
    `,
    profileSchema,
    signal,
    undefined,
    // One of the two is always "not found"; that is the answer, not a failure.
    true,
  );
  if (data.user) {
    const user = data.user;
    return {
      login: user.login,
      name: user.name ?? '',
      bio: user.bio ?? '',
      company: user.company ?? '',
      location: user.location ?? '',
      website: user.websiteUrl ?? '',
      createdAt: user.createdAt,
      followers: user.followers.totalCount,
      following: user.following.totalCount,
      viewerIsFollowing: user.viewerIsFollowing,
      isViewer: user.isViewer,
      isOrganization: false,
      repos: toRepos(user.repositories),
    };
  }
  if (data.organization) {
    const org = data.organization;
    return {
      login: org.login,
      name: org.name ?? '',
      bio: org.description ?? '',
      company: '',
      location: org.location ?? '',
      website: org.websiteUrl ?? '',
      createdAt: org.createdAt,
      followers: 0,
      following: 0,
      viewerIsFollowing: null,
      isViewer: false,
      isOrganization: true,
      repos: toRepos(org.repositories),
    };
  }
  return null;
}

// --- search -------------------------------------------------------------------

export type SearchKind = 'repos' | 'issues' | 'pulls' | 'users';

export type SearchHit =
  | { kind: 'repo'; repo: string; description: string; stars: number }
  | {
      kind: 'issue' | 'pull';
      repo: string;
      number: number;
      title: string;
      state: string;
      author: string;
    }
  | { kind: 'user'; login: string; name: string; bio: string };

const searchSchema = z.object({
  search: z.object({
    issueCount: z.number().optional(),
    repositoryCount: z.number().optional(),
    userCount: z.number().optional(),
    nodes: z.array(
      z
        .object({
          __typename: z.string(),
          nameWithOwner: z.string().optional(),
          description: z.string().nullable().optional(),
          stargazerCount: z.number().optional(),
          number: z.number().optional(),
          title: z.string().optional(),
          state: z.string().optional(),
          author: z.object({ login: z.string() }).nullable().optional(),
          repository: z.object({ nameWithOwner: z.string() }).optional(),
          login: z.string().optional(),
          name: z.string().nullable().optional(),
          bio: z.string().nullable().optional(),
        })
        .nullable(),
    ),
  }),
});

/** The query GitHub is sent for a kind — pull requests and issues share a type. */
export function searchQuery(kind: SearchKind, terms: string): { type: string; query: string } {
  const trimmed = terms.trim();
  switch (kind) {
    case 'repos':
      return { type: 'REPOSITORY', query: trimmed };
    case 'issues':
      return { type: 'ISSUE', query: /\bis:(issue|pr)\b/.test(trimmed) ? trimmed : `${trimmed} is:issue` };
    case 'pulls':
      return { type: 'ISSUE', query: /\bis:(issue|pr)\b/.test(trimmed) ? trimmed : `${trimmed} is:pr` };
    case 'users':
      return { type: 'USER', query: trimmed };
  }
}

export async function searchGitHub(
  token: string,
  kind: SearchKind,
  terms: string,
  signal?: AbortSignal,
): Promise<{ total: number; hits: SearchHit[] }> {
  const { type, query } = searchQuery(kind, terms);
  const data = await executeQuery(
    token,
    /* GraphQL */ `
      query Search($query: String!) {
        search(query: $query, type: ${type}, first: 30) {
          issueCount repositoryCount userCount
          nodes {
            __typename
            ... on Repository { nameWithOwner description stargazerCount }
            ... on Issue { number title state author { login } repository { nameWithOwner } }
            ... on PullRequest { number title state author { login } repository { nameWithOwner } }
            ... on User { login name bio }
            ... on Organization { login name description }
          }
        }
      }
    `,
    searchSchema,
    signal,
    { query },
  );
  const total =
    type === 'REPOSITORY'
      ? (data.search.repositoryCount ?? 0)
      : type === 'USER'
        ? (data.search.userCount ?? 0)
        : (data.search.issueCount ?? 0);
  const hits = data.search.nodes.flatMap((node): SearchHit[] => {
    if (!node) return [];
    switch (node.__typename) {
      case 'Repository':
        return [
          {
            kind: 'repo',
            repo: node.nameWithOwner ?? '',
            description: node.description ?? '',
            stars: node.stargazerCount ?? 0,
          },
        ];
      case 'Issue':
      case 'PullRequest':
        return [
          {
            kind: node.__typename === 'Issue' ? 'issue' : 'pull',
            repo: node.repository?.nameWithOwner ?? '',
            number: node.number ?? 0,
            title: node.title ?? '',
            state: node.state ?? '',
            author: node.author?.login ?? 'ghost',
          },
        ];
      case 'User':
      case 'Organization':
        return [
          {
            kind: 'user',
            login: node.login ?? '',
            name: node.name ?? '',
            bio: node.bio ?? node.description ?? '',
          },
        ];
      default:
        return [];
    }
  });
  return { total, hits };
}

// --- gists --------------------------------------------------------------------

export interface GistRow {
  id: string;
  description: string;
  files: string[];
  public: boolean;
  updatedAt: string;
  owner: string;
}

export interface Gist extends GistRow {
  contents: { filename: string; text: string; truncated: boolean }[];
  url: string;
}

const gistFile = z.object({
  filename: z.string(),
  content: z.string().optional(),
  truncated: z.boolean().optional(),
});

const gistRowSchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  public: z.boolean(),
  updated_at: z.string(),
  html_url: z.string(),
  owner: z.object({ login: z.string() }).nullable(),
  files: z.record(z.string(), gistFile.nullable()),
});

function toGistRow(gist: z.infer<typeof gistRowSchema>): GistRow {
  return {
    id: gist.id,
    description: gist.description ?? '',
    files: Object.keys(gist.files),
    public: gist.public,
    updatedAt: gist.updated_at,
    owner: gist.owner?.login ?? 'ghost',
  };
}

/** Yours, secret ones included, or someone else's public ones. */
export async function listGists(
  token: string,
  login: string | null,
  signal?: AbortSignal,
): Promise<GistRow[]> {
  const path = login ? `/users/${encodeURIComponent(login)}/gists` : '/gists';
  const gists = await rest(token, `${path}?per_page=30`, { schema: z.array(gistRowSchema), signal });
  return gists.map(toGistRow);
}

export async function fetchGist(token: string, id: string, signal?: AbortSignal): Promise<Gist> {
  const gist = await rest(token, `/gists/${encodeURIComponent(id)}`, { schema: gistRowSchema, signal });
  return {
    ...toGistRow(gist),
    url: gist.html_url,
    contents: Object.values(gist.files).flatMap((file) =>
      file ? [{ filename: file.filename, text: file.content ?? '', truncated: file.truncated ?? false }] : [],
    ),
  };
}

export async function isGistStarred(token: string, id: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await rest(token, `/gists/${encodeURIComponent(id)}/star`, { signal });
    return true;
  } catch {
    return false;
  }
}
