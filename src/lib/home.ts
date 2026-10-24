import type { SocialEvent } from './social';

/**
 * What `today` lists at its foot, after the year and the hours.
 *
 * The page used to end in a stretch of empty paper with two buttons at the
 * bottom. It now carries a short feed, and which kinds of thing go in it is
 * a setting (on the account page) rather than a decision made here: the list
 * below is the whole menu, and adding a kind means adding a line to it.
 * Comments on your pull requests are the only thing on by default.
 */
export type HomeBlock = 'pr-comments' | 'reviews' | 'review-requests' | 'mentions';

export const HOME_BLOCKS: { key: HomeBlock; label: string }[] = [
  { key: 'pr-comments', label: 'pr comments' },
  { key: 'reviews', label: 'reviews' },
  { key: 'review-requests', label: 'review requests' },
  { key: 'mentions', label: 'mentions' },
];

export interface HomeSettings {
  blocks: HomeBlock[];
}

export const DEFAULT_HOME: HomeSettings = { blocks: ['pr-comments'] };

/**
 * How much history the feed keeps while scrolling. Older pages are dropped
 * (the next cursor still walks back from the newest retained page) so a long
 * session does not keep every event it has ever drawn.
 */
export const HISTORY_WINDOW = 6;

/** One cursor-addressed page of pull-request conversation. */
export interface HistoryPage {
  /** Cursor this page was requested with; null is the newest page. */
  after: string | null;
  events: SocialEvent[];
  /** Cursor for the page after this one; null when GitHub has nothing older. */
  next: string | null;
}

export interface HistoryWindow {
  pages: HistoryPage[];
  /** Ids of events still in the window, kept incrementally as pages move. */
  ids: ReadonlySet<string>;
}

export const EMPTY_HISTORY: HistoryWindow = { pages: [], ids: new Set() };

/** Events still held, newest page first. */
export function historyEvents(window: HistoryWindow): SocialEvent[] {
  return window.pages.flatMap((page) => page.events);
}

/**
 * Append a page, then drop the pages that have scrolled out until only `keep`
 * remain. The id index is updated from the pages that enter and leave: the
 * leaving pages' ids are removed first, then the retained pages' ids are
 * re-added, so an event GitHub returned on two overlapping pages stays
 * indexed while either copy is held. The cursor to request next is the `next`
 * of the oldest page still kept.
 */
export function retainHistory(
  window: HistoryWindow,
  page: HistoryPage,
  keep = HISTORY_WINDOW,
): HistoryWindow {
  const pages = [...window.pages, page];
  const drop = Math.max(0, pages.length - keep);
  const kept = drop > 0 ? pages.slice(drop) : pages;
  const ids = new Set(window.ids);
  for (const gone of pages.slice(0, drop)) {
    for (const event of gone.events) ids.delete(event.id);
  }
  for (const retained of kept) {
    for (const event of retained.events) ids.add(event.id);
  }
  return { pages: kept, ids };
}

export function blockOf(event: SocialEvent): HomeBlock | null {
  switch (event.kind) {
    case 'comment':
      return 'pr-comments';
    case 'review':
      return 'reviews';
    case 'review-request':
      return 'review-requests';
    case 'mention':
      return 'mentions';
    case 'open':
      return null;
  }
}

/**
 * The rows for the page, newest first: the inbox's feed and however much of
 * the history has been paged in, the same comment counted once.
 */
/**
 * The rows for the page, newest first. Inbox events come first; history is
 * added only when its id is not already in the inbox or an earlier history
 * page. `historyIds` is the incremental index from `retainHistory`, so a
 * settings change does not rescan identity — it only re-filters kinds.
 */
export function homeEvents(
  inbox: readonly SocialEvent[],
  history: readonly SocialEvent[],
  settings: HomeSettings,
  historyIds?: ReadonlySet<string>,
): SocialEvent[] {
  const on = new Set(settings.blocks);
  const seen = new Set<string>();
  const rows: SocialEvent[] = [];
  const take = (event: SocialEvent) => {
    const block = blockOf(event);
    if (block == null || !on.has(block) || seen.has(event.id)) return;
    seen.add(event.id);
    rows.push(event);
  };
  for (const event of inbox) take(event);
  for (const event of history) {
    if (historyIds && !historyIds.has(event.id)) continue;
    take(event);
  }
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return rows;
}

/** A saved setting from an older version (or a hand-edited file) is read defensively. */
export function readHome(raw: unknown): HomeSettings {
  const keys = new Set<string>(HOME_BLOCKS.map((block) => block.key));
  if (raw && typeof raw === 'object' && Array.isArray((raw as HomeSettings).blocks)) {
    return {
      blocks: (raw as HomeSettings).blocks.filter((key): key is HomeBlock => keys.has(key)),
    };
  }
  return DEFAULT_HOME;
}
