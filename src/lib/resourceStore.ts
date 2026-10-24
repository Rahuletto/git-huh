/** Immutable public state for one shared remote resource. */
export interface ResourceSnapshot<T> {
  readonly value: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly savedAt: number | null;
  readonly freshAt: number | null;
  readonly origin: 'disk' | 'network' | null;
  readonly failure: string | null;
  readonly version: number;
}

type ResourceUpdate<T> = Partial<Omit<ResourceSnapshot<T>, 'version'>>;

const snapshots = new Map<string, ResourceSnapshot<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function initialSnapshot<T>(): ResourceSnapshot<T> {
  return {
    value: undefined,
    error: null,
    loading: false,
    refreshing: false,
    savedAt: null,
    freshAt: null,
    origin: null,
    failure: null,
    version: 0,
  };
}

/** Return the same immutable object until the resource is published again. */
export function getResourceSnapshot<T>(key: string): ResourceSnapshot<T> {
  let current = snapshots.get(key) as ResourceSnapshot<T> | undefined;
  if (!current) {
    current = Object.freeze(initialSnapshot<T>());
    snapshots.set(key, current as ResourceSnapshot<unknown>);
  }
  return current;
}

/** Install a new snapshot before notifying subscribers. */
export function publishResource<T>(key: string, update: ResourceUpdate<T>): void {
  const current = getResourceSnapshot<T>(key);
  snapshots.set(
    key,
    Object.freeze({ ...current, ...update, version: current.version + 1 }),
  );
  for (const listener of listeners.get(key) ?? []) listener();
}

export function subscribeResource(key: string, listener: () => void): () => void {
  let resourceListeners = listeners.get(key);
  if (!resourceListeners) {
    resourceListeners = new Set();
    listeners.set(key, resourceListeners);
  }
  resourceListeners.add(listener);
  return () => {
    resourceListeners?.delete(listener);
    if (resourceListeners?.size === 0) listeners.delete(key);
  };
}

/** Drop the snapshot after the owning remote entry has passed its idle grace period. */
export function dropResourceSnapshot(key: string): void {
  if (listeners.has(key)) return;
  snapshots.delete(key);
}
