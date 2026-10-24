import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { escapeName, KEY_SEPARATOR } from './cacheKey';

/**
 * A small JSON box on disk, for everything the app wants to still have when
 * the network is gone.
 *
 * SecureStore is where secrets live and it warns past 2 KB a value; a year of
 * contributions is forty times that. This is the app's documents directory,
 * one file per key, each carrying the time it was written — because a saved
 * answer shown without its age is a lie about the present.
 *
 * Nothing in here is secret. Tokens stay in the keystore (`accounts.ts`).
 *
 * The box is bounded. A long browsing session used to grow one file per file,
 * branch and pull request forever; now each write notes the size and the last
 * time the key was touched, and the least recently used answers are dropped
 * once the box passes its budget. Drafts and settings are not answers: they
 * are things the person wrote, so they are never candidates for eviction.
 */

export interface Saved<T> {
  value: T;
  /** Epoch ms the value was written. */
  at: number;
}

const web = Platform.OS === 'web';
const memory = new Map<string, string>();

/** How large the box may grow before older answers start leaving. */
const DEFAULT_BUDGET = 32 * 1024 * 1024;

/** How long a burst of writes waits before the index itself is written. */
const INDEX_DEBOUNCE_MS = 1_500;

const INDEX_KEY = '~index';

interface IndexEntry {
  bytes: number;
  at: number;
  pinned: boolean;
}

const index = new Map<string, IndexEntry>();
let indexLoaded = false;
let indexTimer: ReturnType<typeof setTimeout> | null = null;
let indexWriting: Promise<void> | null = null;

interface PendingWrite {
  raw: string;
  generation: number;
  promise: Promise<void>;
  resolve: () => void;
}

/** One chain per key, so two writes of the same answer cannot pass each other. */
const queues = new Map<string, Promise<void>>();
/** The generation of the newest snapshot asked for, so a late write is a no-op. */
const generations = new Map<string, number>();
/** The body last successfully written, so an identical refresh skips the disk. */
const lastWritten = new Map<string, string>();
/** A write that has not started yet, replaced when a newer snapshot arrives. */
const pending = new Map<string, PendingWrite>();

function folder(): Directory {
  const dir = new Directory(Paths.document, 'githuh-store');
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/**
 * Keys become file names. The escape is injective — `_` is escaped too — so
 * two keys that differ only by a character the filesystem cannot keep still
 * land in two files.
 */
function fileFor(key: string): File {
  return new File(folder(), `${escapeName(key)}.json`);
}

function durable(key: string): boolean {
  return (
    key.includes(`${KEY_SEPARATOR}draft${KEY_SEPARATOR}`) ||
    key.includes('home-settings') ||
    key.includes('accounts-together') ||
    key === INDEX_KEY
  );
}

async function ensureIndex(): Promise<void> {
  if (indexLoaded) return;
  indexLoaded = true;
  const saved = await readEnvelope<Record<string, IndexEntry>>(INDEX_KEY);
  if (!saved) return;
  for (const [key, entry] of Object.entries(saved.value)) {
    if (entry && typeof entry.bytes === 'number' && typeof entry.at === 'number') {
      index.set(key, { bytes: entry.bytes, at: entry.at, pinned: entry.pinned === true });
    }
  }
}

function scheduleIndex(): void {
  if (indexTimer) clearTimeout(indexTimer);
  indexTimer = setTimeout(() => {
    indexTimer = null;
    const writing = flushIndex();
    indexWriting = writing.finally(() => {
      if (indexWriting === writing) indexWriting = null;
    });
  }, INDEX_DEBOUNCE_MS);
}

async function flushIndex(): Promise<void> {
  const snapshot: Record<string, IndexEntry> = {};
  for (const [key, entry] of index) snapshot[key] = entry;
  await writeBody(INDEX_KEY, JSON.stringify({ value: snapshot, at: Date.now() }));
}

function noteAccess(key: string, bytes: number | null): void {
  if (key === INDEX_KEY) return;
  const previous = index.get(key);
  index.set(key, {
    bytes: bytes ?? previous?.bytes ?? 0,
    at: Date.now(),
    pinned: previous?.pinned ?? false,
  });
  scheduleIndex();
}

function forgetIndex(key: string): void {
  if (!index.delete(key)) return;
  scheduleIndex();
}

async function readEnvelope<T>(key: string): Promise<Saved<T> | null> {
  try {
    const raw = web ? memory.get(key) : await readFile(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Saved<T>>;
    if (parsed == null || typeof parsed.at !== 'number' || !('value' in parsed)) {
      return null;
    }
    return parsed as Saved<T>;
  } catch {
    return null;
  }
}

/**
 * The saved answer, or null when there is none, it cannot be read, or it
 * fails `validate`. A caller that knows the shape passes a check; a value
 * that used to be that shape and no longer is is dropped rather than handed
 * to a screen that will treat it as current.
 */
export async function readSaved<T>(
  key: string,
  validate?: (value: unknown) => T | null,
): Promise<Saved<T> | null> {
  const parsed = await readEnvelope<T>(key);
  if (!parsed) return null;
  if (validate) {
    const value = validate(parsed.value);
    if (value == null) {
      await removeSaved(key);
      return null;
    }
    parsed.value = value;
  }
  if (!web) await ensureIndex();
  noteAccess(key, null);
  return parsed;
}

async function readFile(key: string): Promise<string | null> {
  const file = fileFor(key);
  return file.exists ? file.text() : null;
}

/**
 * Remember a value. Writes of one key run in order; a newer snapshot
 * replaces one that has not started, and a write that finishes after a newer
 * one was asked for does not land. An identical body is not written again.
 */
export async function writeSaved<T>(key: string, value: T): Promise<void> {
  const raw = JSON.stringify({ value, at: Date.now() } satisfies Saved<T>);
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);

  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const previous = pending.get(key);
  pending.set(key, { raw, generation, promise, resolve });
  previous?.resolve();

  const chain = (queues.get(key) ?? Promise.resolve()).then(() => runWrite(key));
  queues.set(key, chain);
  return promise;
}

async function runWrite(key: string): Promise<void> {
  const next = pending.get(key);
  if (!next) return;
  pending.delete(key);
  if (generations.get(key) !== next.generation) {
    next.resolve();
    return;
  }
  if (lastWritten.get(key) === next.raw) {
    noteAccess(key, next.raw.length);
    next.resolve();
    return;
  }
  await writeBody(key, next.raw);
  if (generations.get(key) === next.generation) {
    lastWritten.set(key, next.raw);
    if (!web) await ensureIndex();
    noteAccess(key, next.raw.length);
    if (!durable(key)) void pruneSavedCache();
  }
  next.resolve();
}

async function writeBody(key: string, raw: string): Promise<void> {
  if (web) {
    memory.set(key, raw);
    return;
  }
  try {
    const file = fileFor(key);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    file.write(raw);
  } catch {
    // Saving is a convenience. Failing to save must never fail the screen.
  }
}

export async function removeSaved(key: string): Promise<void> {
  generations.set(key, (generations.get(key) ?? 0) + 1);
  lastWritten.delete(key);
  pending.get(key)?.resolve();
  pending.delete(key);
  forgetIndex(key);
  if (web) {
    memory.delete(key);
    return;
  }
  try {
    const file = fileFor(key);
    if (file.exists) file.delete();
  } catch {
    // Nothing to remove is the same as removed.
  }
}

/** Everything under any of the prefixes — used when an account is removed. */
export async function removeSavedPrefixes(prefixes: string[]): Promise<void> {
  if (prefixes.length === 0) return;
  const matches = (name: string) => prefixes.some((prefix) => name.startsWith(prefix));
  if (web) {
    for (const key of [...memory.keys()]) {
      if (matches(escapeName(key))) {
        memory.delete(key);
        forgetIndex(key);
      }
    }
    return;
  }
  try {
    for (const entry of folder().list()) {
      if (!(entry instanceof File) || !matches(entry.name)) continue;
      const stem = entry.name.endsWith('.json') ? entry.name.slice(0, -5) : entry.name;
      for (const [key] of index) {
        if (escapeName(key) === stem) forgetIndex(key);
      }
      entry.delete();
    }
  } catch {
    // Best effort, like every other write here.
  }
}

/** Everything under a prefix — used when an account is removed. */
export async function removeSavedPrefix(prefix: string): Promise<void> {
  await removeSavedPrefixes([escapeName(prefix)]);
}

/**
 * Keep this answer past the budget. A year the person is looking at, a file
 * they asked to have offline: eviction skips it until it is unpinned.
 */
export function pinSaved(key: string): void {
  const entry = index.get(key) ?? { bytes: 0, at: Date.now(), pinned: false };
  entry.pinned = true;
  index.set(key, entry);
  scheduleIndex();
}

export function unpinSaved(key: string): void {
  const entry = index.get(key);
  if (!entry) return;
  entry.pinned = false;
  scheduleIndex();
}

/**
 * Drop the least recently used answers until the box fits. Drafts, settings
 * and pinned keys stay. Called after writes; safe to call directly.
 */
export async function pruneSavedCache(budgetBytes: number = DEFAULT_BUDGET): Promise<void> {
  if (!web) await ensureIndex();
  let total = 0;
  for (const entry of index.values()) total += entry.bytes;
  if (total <= budgetBytes) return;
  const order = [...index.entries()]
    .filter(([key, entry]) => !entry.pinned && !durable(key))
    .sort((a, b) => a[1].at - b[1].at);
  for (const [key, entry] of order) {
    if (total <= budgetBytes) break;
    total -= entry.bytes;
    await removeSaved(key);
  }
}

/**
 * A stable, short name for something that must not be written down as-is —
 * a token, which identifies the account whose answers these are.
 */
export function keyOf(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}

/** Short age for a saved answer, in the app's own voice: `4m`, `3h`, `2d`. */
export function savedAge(at: number, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
