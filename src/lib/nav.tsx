import { createContext, useContext } from 'react';

import type { ShareKind } from './shareData';

/**
 * Everything that opens *over* the sections: a pull request, an issue or a
 * discussion, a repository, a file, the new-issue form, a second account,
 * the account page, a chart made into an image to share, and the long lists
 * whose head is all a section's page has room for.
 *
 * These are a stack, the way detail views are on every phone: each one
 * pushes over the last and `back` pops it, so a pull request opened from a
 * repository opened from the inbox goes back the way it came. They sit over
 * the sections, the bar included, because a detail page has its own way
 * back and the bar's sections are not where it lives.
 */
/** The views of a repository, in the order its page lists them. */
export const REPO_TABS = [
  'code',
  'pulls',
  'issues',
  'actions',
  'releases',
  'discussions',
  'security',
] as const;
export type RepoTab = (typeof REPO_TABS)[number];

export type Route =
  | { kind: 'pull'; repo: string; number: number }
  | { kind: 'thread'; repo: string; number: number; type: 'issue' | 'discussion' }
  | { kind: 'repo'; repo: string; tab?: RepoTab }
  | {
      kind: 'file';
      repo: string;
      path: string;
      ref?: string;
      /** A search term to find as soon as the file opens. */
      find?: string;
    }
  | { kind: 'new-issue'; repo: string }
  /** Open a pull request from one branch into another. */
  | { kind: 'new-pull'; repo: string; head?: string }
  | { kind: 'new-release'; repo: string }
  | { kind: 'new-discussion'; repo: string }
  /** A file that does not exist yet, in `dir` on `ref`. */
  | { kind: 'new-file'; repo: string; dir: string; ref: string }
  | { kind: 'new-repo' }
  /** A person or an organisation: their profile, their repositories, follow. */
  | { kind: 'user'; login: string }
  /** Repositories, issues, pull requests and people, across GitHub. */
  | { kind: 'search'; query?: string }
  /** Someone's gists, or yours when no login is given. */
  | { kind: 'gists'; login?: string }
  | { kind: 'gist'; id: string }
  | { kind: 'new-gist' }
  | { kind: 'add-account' }
  /** Accounts, which of them are added together, notifications, the home feed. */
  | { kind: 'account' }
  /** A chart as a 4:3 image, to post somewhere. */
  | { kind: 'share'; card: ShareKind; year?: number }
  /** The review queue in full: asked of you, and reviewed by you. */
  | { kind: 'queue' }
  /** Everything assigned to you, and the issues you filed. */
  | { kind: 'assigned' }
  /** Your pull requests' descriptions, read one after another. */
  | { kind: 'brief' }
  /** Everyone you reviewed with this year. */
  | { kind: 'people' };

export interface Nav {
  open: (route: Route) => void;
  /** Swap the top of the stack — a file becomes the pull request it proposed. */
  replace: (route: Route) => void;
  close: () => void;
  token: string | null;
  login: string | null;
  demo: boolean;
}

export const NavContext = createContext<Nav>({
  open: () => {},
  replace: () => {},
  close: () => {},
  token: null,
  login: null,
  demo: false,
});

export function useNav(): Nav {
  return useContext(NavContext);
}

/**
 * First path segments on github.com that are GitHub's own pages rather than
 * an owner — `github.com/settings/tokens` is not a repository called
 * `settings/tokens`.
 */
const RESERVED = new Set([
  'about',
  'apps',
  'codespaces',
  'collections',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'search',
  'settings',
  'sponsors',
  'topics',
  'trending',
]);

const GITHUB_PATH = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)(\/[^?#]*)?/;
const GITHUB_OWNER = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/?(?:[?#].*)?$/;
const GIST = /^https?:\/\/gist\.github\.com\/(?:[^/?#]+\/)?([0-9a-f]{8,})/i;

/** The parts of a repository that have a tab of their own here. */
const TAB_FOR: Record<string, RepoTab> = {
  pulls: 'pulls',
  issues: 'issues',
  actions: 'actions',
  releases: 'releases',
  tags: 'releases',
  discussions: 'discussions',
  security: 'security',
  tree: 'code',
};

/**
 * A github.com link, read as somewhere inside the app. Anything this cannot
 * place stays a link and leaves for the browser, once, on purpose.
 */
export function routeForUrl(url: string): Route | null {
  const gist = GIST.exec(url);
  if (gist) return { kind: 'gist', id: gist[1] };
  const owner = GITHUB_OWNER.exec(url);
  if (owner) {
    return RESERVED.has(owner[1].toLowerCase()) ? null : { kind: 'user', login: owner[1] };
  }
  const match = GITHUB_PATH.exec(url);
  if (!match || RESERVED.has(match[1].toLowerCase())) return null;
  const repo = `${match[1]}/${match[2].replace(/\.git$/, '')}`;
  const [, section, ...rest] = (match[3] ?? '').split('/');

  if (!section) return { kind: 'repo', repo };
  const number = Number(rest[0]);
  switch (section) {
    case 'pull':
      return Number.isInteger(number) && number > 0 ? { kind: 'pull', repo, number } : null;
    case 'issues':
      if (rest[0] === 'new') return { kind: 'new-issue', repo };
      return Number.isInteger(number) && number > 0
        ? { kind: 'thread', repo, number, type: 'issue' }
        : rest.length === 0
          ? { kind: 'repo', repo, tab: 'issues' }
          : null;
    case 'discussions':
      return Number.isInteger(number) && number > 0
        ? { kind: 'thread', repo, number, type: 'discussion' }
        : rest.length === 0
          ? { kind: 'repo', repo, tab: 'discussions' }
          : null;
    case 'compare': {
      // `compare/<base>...<head>`, or just a head.
      const spec = rest.join('/');
      const head = spec.includes('...') ? spec.split('...')[1] : spec;
      return { kind: 'new-pull', repo, ...(head ? { head: decodeURIComponent(head) } : {}) };
    }
    case 'blob': {
      // `blob/<ref>/<path>`. A ref with a slash in it is ambiguous in the URL
      // itself; the first segment is by far the common case.
      const [ref, ...path] = rest;
      if (!ref || path.length === 0) return null;
      try {
        return { kind: 'file', repo, ref, path: decodeURIComponent(path.join('/')) };
      } catch {
        return null;
      }
    }
    default: {
      // A run, a tag or a commit opens the tab it lives under; wikis,
      // projects and settings have no page here and leave for the browser.
      const tab = TAB_FOR[section];
      return tab ? { kind: 'repo', repo, tab } : null;
    }
  }
}
