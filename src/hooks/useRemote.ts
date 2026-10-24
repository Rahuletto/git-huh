import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { GitHubError } from '../lib/github';
import { readSaved, writeSaved } from '../lib/store';

/** Why the last attempt failed, when the screen still has something to show. */
export type RemoteFailure =
  | 'network'
  | 'forbidden'
  | 'rate-limited'
  | 'missing'
  | 'invalid-token'
  | 'api'
  | null;

export type Remote<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      data: T;
      /** When this answer was saved, if it came off the disk. */
      savedAt: number | null;
      /** True when the saved answer is on screen because GitHub could not be reached. */
      offline: boolean;
      /** True while a newer answer is on its way. */
      refreshing: boolean;
      /** Set when a refresh failed but the previous answer is still the one shown. */
      failure?: RemoteFailure;
      /** True when the answer is past `staleAfterMs` and a refresh is due or under way. */
      stale?: boolean;
    }
  | { status: 'error'; error: unknown; failure?: RemoteFailure };

interface Entry<T> {
  value: T | undefined;
  at: number | null;
  /** Where the current value came from. Disk answers keep their written time. */
  origin: 'disk' | 'network' | null;
  flight: Promise<T> | null;
  subscribers: number;
  failure: RemoteFailure;
  error: unknown;
  generation: number;
  /** Epoch ms of the last network success, for freshness. */
  freshAt: number | null;
  validate: ((value: unknown) => T | null) | null;
  listeners: Set<() => void>;
  evict: ReturnType<typeof setTimeout> | null;
}

const registry = new Map<string, Entry<unknown>>();

/** How long an unsubscribed heavy entry stays before the registry lets it go. */
const EVICT_AFTER_MS = 30_000;

function entryFor<T>(key: string): Entry<T> {
  let entry = registry.get(key) as Entry<T> | undefined;
  if (!entry) {
    entry = {
      value: undefined,
      at: null,
      origin: null,
      flight: null,
      subscribers: 0,
      failure: null,
      error: null,
      generation: 0,
      freshAt: null,
      validate: null,
      listeners: new Set(),
      evict: null,
    };
    registry.set(key, entry as Entry<unknown>);
  }
  return entry;
}

function publish(entry: Entry<unknown>): void {
  for (const listener of entry.listeners) listener();
}

function failureOf(error: unknown): RemoteFailure {
  if (!(error instanceof GitHubError)) return 'api';
  if (error.kind === 'api' && /rate limit/i.test(error.message)) return 'rate-limited';
  return error.kind;
}

function subscribe(key: string, listener: () => void): () => void {
  const entry = entryFor(key);
  entry.listeners.add(listener);
  entry.subscribers += 1;
  if (entry.evict) {
    clearTimeout(entry.evict);
    entry.evict = null;
  }
  return () => {
    entry.listeners.delete(listener);
    entry.subscribers -= 1;
    if (entry.subscribers > 0) return;
    // Nobody is looking. Keep the value briefly so a tab switch does not
    // throw away a payload it is about to ask for again, then drop it.
    entry.evict = setTimeout(() => {
      if (entry.subscribers === 0) registry.delete(key);
    }, EVICT_AFTER_MS);
  };
}

function snapshot<T>(key: string): Entry<T> {
  return entryFor<T>(key);
}

async function loadInto<T>(
  key: string,
  cacheKey: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  validate: ((value: unknown) => T | null) | null,
  persist: boolean,
): Promise<T> {
  const entry = entryFor<T>(key);
  if (entry.flight) return entry.flight;
  const generation = entry.generation + 1;
  entry.generation = generation;
  const controller = new AbortController();
  const flight = load(controller.signal)
    .then((value) => {
      if (entry.generation !== generation) return value;
      entry.value = value;
      entry.at = Date.now();
      entry.origin = 'network';
      entry.freshAt = entry.at;
      entry.failure = null;
      entry.error = null;
      entry.flight = null;
      publish(entry);
      if (cacheKey && persist) writeSaved(cacheKey, value).catch(() => {});
      return value;
    })
    .catch((error: unknown) => {
      if (entry.generation === generation) {
        entry.flight = null;
        if (!(error instanceof Error && error.name === 'AbortError')) {
          entry.failure = failureOf(error);
          entry.error = error;
          publish(entry);
        }
      }
      throw error;
    });
  entry.flight = flight;
  publish(entry);
  return flight;
}

/**
 * Forget a resource so the next consumer reads it again. Exact key: the
 * request key `useRemote` was given, which is also the registry key.
 */
export function invalidateResource(key: string): void {
  const entry = registry.get(key);
  if (!entry) return;
  entry.value = undefined;
  entry.at = null;
  entry.origin = null;
  entry.freshAt = null;
  entry.failure = null;
  entry.error = null;
  entry.generation += 1;
  publish(entry);
}

/** Forget every resource whose key the predicate accepts. */
export function invalidateResourceWhere(match: (key: string) => boolean): void {
  for (const key of [...registry.keys()]) {
    if (match(key)) invalidateResource(key);
  }
}

/** Ask the current subscribers' resource to load again. */
export function refreshResource(key: string): void {
  const entry = registry.get(key);
  if (!entry) return;
  entry.generation += 1;
  entry.flight = null;
  publish(entry);
}

/**
 * Cache-first loading, the one pattern behind every request in the app.
 *
 * The saved answer is on screen the moment it is read off the disk; the
 * fresh one replaces it when it lands; and when GitHub cannot be reached the
 * saved one stays, labelled with its age, instead of the screen turning into
 * an error. A cold start with a warm cache therefore draws real data before
 * the first request has left the phone — which is most of what "fast" means.
 *
 * Two screens asking for the same key share one in-flight request and one
 * current value. Unmounting one does not abort a request the other still
 * needs. A null key means this consumer is disabled; it does not throw away
 * the value the registry is holding for someone else.
 */
export function useRemote<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  {
    cacheKey = null,
    persist = true,
    demo,
    validate,
    staleAfterMs,
  }: {
    /** Where the answer is saved on the device. null = never saved. */
    cacheKey?: string | null;
    /**
     * Whether a fresh answer is written back. A caller that compares samples
     * itself passes false so an unchanged poll does not rewrite the file,
     * while the saved answer is still read for the first frame.
     */
    persist?: boolean;
    /** A ready answer for the demo account, computed by the caller. */
    demo?: T;
    /** Applied to the disk value only. Network results are checked by callers. */
    validate?: (value: unknown) => T | null;
    /** Past this age a ready answer is stale and revalidated in the background. */
    staleAfterMs?: number;
  } = {},
): Remote<T> & { reload: () => void } {
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  const active = key != null && demo === undefined ? key : null;
  const entry = useSyncExternalStore(
    useCallback(
      (listener: () => void) => (active ? subscribe(active, listener) : () => {}),
      [active],
    ),
    useCallback(() => (active ? snapshot<T>(active) : null), [active]),
    useCallback(() => (active ? snapshot<T>(active) : null), [active]),
  );

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => {
    if (active) {
      const current = entryFor<T>(active);
      current.generation += 1;
      current.flight = null;
    }
    setNonce((value) => value + 1);
  }, [active]);

  useEffect(() => {
    if (!active || !entry) return;
    if (validate) entryFor<T>(active).validate = validate;
    if (entry.value !== undefined) return;
    if (!cacheKey) return;
    let cancelled = false;
    const generation = entry.generation;
    readSaved<T>(cacheKey, validate ?? entry.validate ?? undefined).then((saved) => {
      if (cancelled || !saved) return;
      const current = entryFor<T>(active);
      if (current.generation !== generation) return;
      if (current.value !== undefined) return;
      current.value = saved.value;
      current.at = saved.at;
      current.origin = 'disk';
      publish(current);
    });
    return () => {
      cancelled = true;
    };
  }, [active, cacheKey, entry, validate]);

  useEffect(() => {
    if (!active || !entry) return;
    const fresh =
      entry.freshAt != null &&
      (staleAfterMs == null || Date.now() - entry.freshAt < staleAfterMs);
    if (fresh && nonce === 0 && entry.flight == null) return;
    let cancelled = false;
    loadInto(active, cacheKey, (signal) => loader.current(signal), validate ?? null, persist).catch(
      () => {
        if (cancelled) return;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, cacheKey, entry, nonce, persist, staleAfterMs, validate]);

  return useMemo(
    () => derive({ key, demo, entry, reload, staleAfterMs }),
    [demo, entry, key, reload, staleAfterMs],
  );
}

function derive<T>({
  key,
  demo,
  entry,
  reload,
  staleAfterMs,
}: {
  key: string | null;
  demo: T | undefined;
  entry: Entry<T> | null;
  reload: () => void;
  staleAfterMs: number | undefined;
}): Remote<T> & { reload: () => void } {
  if (key == null) return { status: 'idle', reload };
  if (demo !== undefined) {
    return {
      status: 'ready',
      data: demo,
      savedAt: null,
      offline: false,
      refreshing: false,
      failure: null,
      stale: false,
      reload,
    };
  }
  if (!entry || entry.value === undefined) {
    if (entry?.failure && entry.error != null && entry.flight == null) {
      return { status: 'error', error: entry.error, failure: entry.failure, reload };
    }
    return { status: 'loading', reload };
  }

  const stale =
    staleAfterMs != null &&
    entry.freshAt != null &&
    Date.now() - entry.freshAt >= staleAfterMs;
  const fromDisk = entry.origin === 'disk';
  const failed = entry.failure;

  if (failed === 'invalid-token' && entry.flight == null && entry.origin !== 'network') {
    return { status: 'error', error: entry.error, failure: failed, reload };
  }

  return {
    status: 'ready',
    data: entry.value,
    savedAt: fromDisk ? entry.at : null,
    offline: failed === 'network',
    refreshing: entry.flight != null,
    failure: failed,
    stale: stale || (fromDisk && entry.flight != null),
    reload,
  };
}
