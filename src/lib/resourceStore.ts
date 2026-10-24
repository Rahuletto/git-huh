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

export interface ResourceWork<T> {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly promise: Promise<T>;
}

interface ActiveResourceWork<T> extends ResourceWork<T> {
  readonly controller: AbortController;
}

const snapshots = new Map<string, ResourceSnapshot<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const generations = new Map<string, number>();
const work = new Map<string, ActiveResourceWork<unknown>>();

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

export function publishResourceForGeneration<T>(
  key: string,
  generation: number,
  update: ResourceUpdate<T>,
): boolean {
  if (!isCurrentResourceGeneration(key, generation)) return false;
  publishResource(key, update);
  return true;
}

export function isCurrentResourceGeneration(key: string, generation: number): boolean {
  return (generations.get(key) ?? 0) === generation;
}

export function getResourceGeneration(key: string): number {
  return generations.get(key) ?? 0;
}

export function startResourceWork<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): ResourceWork<T> {
  const current = work.get(key) as ActiveResourceWork<T> | undefined;
  if (current) return current;

  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  const controller = new AbortController();
  let flight: ActiveResourceWork<T>;
  const promise = Promise.resolve()
    .then(() => load(controller.signal))
    .finally(() => {
      if (work.get(key) === flight) work.delete(key);
    });
  flight = { generation, signal: controller.signal, promise, controller };
  work.set(key, flight as ActiveResourceWork<unknown>);
  return flight;
}

/** Abort and invalidate the current request so its eventual result is obsolete. */
export function cancelResourceWork(key: string): number {
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  const current = work.get(key);
  work.delete(key);
  current?.controller.abort();
  return generation;
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
  cancelResourceWork(key);
  snapshots.delete(key);
  generations.delete(key);
}
