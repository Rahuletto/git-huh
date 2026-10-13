/**
 * The `host` section's data: what `host/hostd.py` serves about one machine —
 * its CPU, memory and disks, the services it was told to watch, their logs,
 * and whatever panels its config defines.
 *
 * The app knows nothing about any particular service. It reads the manifest
 * and the overview and draws the kinds it is given (`PanelKind`), so a new
 * graph on the phone is a few lines in the host's JSON, never a new build.
 *
 * Pure: no React Native, so the shaping and the formatting are tested on Node.
 */

export type PanelKind = 'stat' | 'series' | 'status' | 'list' | 'table' | 'log' | 'bars';
export type Display = 'number' | 'ago' | 'bytes' | 'percent' | 'duration';

export interface PanelMeta {
  id: string;
  title: string;
  kind: PanelKind;
  unit: string;
  display: Display;
  every: number;
  history: boolean;
  max: number | null;
  endpoint: string;
}

export type PanelValue =
  | number
  | string
  | null
  | string[]
  | { ok: boolean; text: string }
  | { columns: string[]; rows: string[][]; total: number }
  | { label: string; value: number }[];

export interface Panel extends PanelMeta {
  value?: PanelValue;
  error?: string;
  pending?: boolean;
  at?: number;
  series?: (number | null)[];
}

export interface Health {
  ok: boolean;
  detail: string;
  ms: number;
  at: number;
}

export interface ServiceState {
  id: string;
  name: string;
  state: string;
  sub?: string;
  description?: string;
  pid?: number | null;
  since?: number | null;
  restarts?: number | null;
  memory?: number | null;
  cpu?: number;
  health?: Health | null;
  detail?: string;
  series: { cpu: (number | null)[]; up: (number | null)[]; memory?: (number | null)[] };
}

export interface HostAction {
  id: string;
  label: string;
  confirm: boolean;
}

export interface ServiceDetail extends ServiceState {
  about: string;
  url: string | null;
  actions: HostAction[];
  panels: Panel[];
  every: number;
}

export interface Overview {
  name: string;
  every: number;
  host: {
    at: number;
    cpu: number;
    cores: number;
    memory: { total: number; used: number; percent: number; swap: number };
    load: number[];
    uptime: number;
    temperature: number | null;
    disks: { path: string; total: number; used: number; percent: number }[];
    series: { cpu: (number | null)[]; memory: (number | null)[]; temperature: (number | null)[] };
  };
  services: ServiceState[];
  panels: Panel[];
}

export interface HostSettings {
  url: string;
  token: string;
}

/** What `hostd` says when its config fails to load. */
export class HostError extends Error {
  /** Words meant for the screen, said as they are (`explain` passes them through). */
  readonly spoken = true;
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'HostError';
    this.status = status;
  }
}

/**
 * What was typed into the address field, as the base of every request:
 * a scheme if it had none (`http://`, the tailnet is already encrypted),
 * no trailing slash, and no `/v1` if it was pasted with one.
 */
export function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, '').replace(/\/v1$/, '');
  return url;
}

/** True when Android's release build will refuse to talk to it in the clear. */
export function blockedInTheClear(url: string): boolean {
  const match = /^http:\/\/([^/:]+)/i.exec(url);
  if (!match) return false;
  const host = match[1].toLowerCase();
  return !(host.endsWith('.ts.net') || host === 'localhost' || host === '127.0.0.1');
}

/**
 * At most `slots` values, each the largest of the run it stands for — a
 * spike survives being squeezed — oldest first. A run with no readings at
 * all stays empty, which the dot row draws as its ghost.
 */
export function squeeze(values: readonly (number | null)[], slots: number): (number | null)[] {
  if (values.length <= slots) return [...values];
  const out: (number | null)[] = [];
  for (let slot = 0; slot < slots; slot++) {
    const start = Math.floor((slot * values.length) / slots);
    const end = Math.floor(((slot + 1) * values.length) / slots);
    let best: number | null = null;
    for (let index = start; index < end; index++) {
      const value = values[index];
      if (value != null && (best == null || value > best)) best = value;
    }
    out.push(best);
  }
  return out;
}

export function bytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const units = ['b', 'kb', 'mb', 'gb', 'tb'];
  let number = value;
  let unit = 0;
  while (Math.abs(number) >= 1024 && unit < units.length - 1) {
    number /= 1024;
    unit++;
  }
  return unit === 0 ? `${Math.round(number)} b` : `${number >= 100 ? Math.round(number) : number.toFixed(1)} ${units[unit]}`;
}

/** `42s`, `3m`, `5h`, `2d`, `1d 4h` — how long, the app's short way. */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 && hours < 10 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  return hours > 0 && days < 10 ? `${days}d ${hours}h` : `${days}d`;
}

/** Seconds (or milliseconds) since the epoch → how long ago. */
export function since(epoch: number | null | undefined, now: number = Date.now()): string {
  if (epoch == null || !Number.isFinite(epoch)) return '—';
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  return duration((now - ms) / 1000);
}

/** A number the way its panel asked to be shown. */
export function showValue(value: number | string | null | undefined, display: Display, unit = ''): string {
  if (value == null) return '—';
  if (typeof value === 'string') return unit ? `${value} ${unit}` : value;
  switch (display) {
    case 'ago':
      return `${since(value)} ago`;
    case 'bytes':
      return bytes(value);
    case 'duration':
      return duration(value);
    case 'percent':
      // Whole points, except under ten, where a service idling at 0.3% is
      // not the same as one at nothing.
      return `${Math.abs(value) < 10 && value !== 0 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)}%`;
    default: {
      const text = round(value);
      return unit ? (unit === '%' || unit.startsWith('°') ? `${text}${unit}` : `${text} ${unit}`) : text;
    }
  }
}

function round(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(value) ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** How a service is doing, in one word and whether it is good. */
export function verdict(service: Pick<ServiceState, 'state' | 'health'>): { word: string; ok: boolean | null } {
  if (service.state === 'active') {
    if (service.health && !service.health.ok) return { word: 'not answering', ok: false };
    return { word: 'up', ok: true };
  }
  if (service.state === 'activating' || service.state === 'reloading') return { word: 'starting', ok: null };
  if (service.state === 'failed') return { word: 'failed', ok: false };
  if (service.state === 'unknown') return { word: 'unknown', ok: null };
  return { word: 'down', ok: false };
}

/** The share of the last readings that were up, as a whole percentage. */
export function uptimeShare(up: readonly (number | null)[]): number | null {
  const known = up.filter((value): value is number => value != null);
  if (known.length === 0) return null;
  return Math.round((100 * known.filter((value) => value > 0).length) / known.length);
}

/**
 * A log line made to fit a phone: the journal's ISO stamp cut to `19:25`, the
 * `unit[pid]:` prefix dropped, and a second timestamp the program printed
 * itself (Go's `2026/10/13 19:25:45`) dropped too. Anything else is as it was.
 */
export function tidyLogLine(line: string): { time: string; text: string } {
  const journal = /^\d{4}-\d\d-\d\dT(\d\d:\d\d):\d\d(?:\.\d+)?(?:[+-]\d{4}|Z)?\s+(?:\S+\[\d+\]:\s*)?(.*)$/.exec(line);
  if (!journal) return { time: '', text: line };
  const text = journal[2].replace(/^\d{4}[/-]\d\d[/-]\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?\s+/, '');
  return { time: journal[1], text };
}

/** Does a log line report a failure — a word on its own, not inside `fetch_error`. */
export function isBadLine(text: string): boolean {
  return /(^|[^\w])(error|fatal|panic|failed|exception|traceback)\b/i.test(text);
}

// --- the demo ------------------------------------------------------------------

function wave(count: number, base: number, swing: number, seed: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    Math.max(0, Math.round((base + swing * Math.sin((index + seed) / 5) + swing * 0.4 * Math.sin((index * seed) / 3)) * 10) / 10),
  );
}

const DEMO_NOW = 1_760_000_000;

/** A machine for the demo account and the screenshots: no real host is asked. */
export function demoOverview(): Overview {
  const panels: Panel[] = [
    { ...meta('load', 'load · 1 min', 'series'), value: 0.8, series: wave(120, 0.9, 0.5, 3) },
    { ...meta('root', 'disk /', 'stat', '%'), max: 100, value: 71 },
    {
      ...meta('top', 'busiest processes', 'table'),
      value: {
        columns: ['process', 'cpu %', 'mem %'],
        rows: [
          ['node', '12.1', '3.4'],
          ['postgres', '4.0', '6.2'],
          ['python3', '1.2', '0.8'],
        ],
        total: 3,
      },
    },
  ];
  return {
    name: 'desk',
    every: 10,
    host: {
      at: DEMO_NOW,
      cpu: 14,
      cores: 12,
      memory: { total: 16 * 2 ** 30, used: 9.2 * 2 ** 30, percent: 57, swap: 0 },
      load: [0.8, 0.9, 0.7],
      uptime: 4 * 86_400 + 3 * 3600,
      temperature: 52,
      disks: [{ path: '/', total: 500 * 2 ** 30, used: 355 * 2 ** 30, percent: 71 }],
      series: { cpu: wave(120, 14, 9, 1), memory: wave(120, 56, 3, 2), temperature: wave(120, 51, 4, 4) },
    },
    services: [
      demoService('site', 'website', 'active', true, 2.1),
      demoService('watcher', 'page watcher', 'active', true, 0.4),
      demoService('backup', 'nightly backup', 'inactive', false, 0),
    ],
    panels,
  };
}

function meta(id: string, title: string, kind: PanelKind, unit = ''): PanelMeta {
  return {
    id,
    title,
    kind,
    unit,
    display: 'number',
    every: 60,
    history: kind === 'series',
    max: null,
    endpoint: `/v1/panels/host/${id}`,
  };
}

function demoService(id: string, name: string, state: string, ok: boolean, cpu: number): ServiceState {
  return {
    id,
    name,
    state,
    sub: state === 'active' ? 'running' : 'dead',
    since: state === 'active' ? DEMO_NOW - 3 * 86_400 : null,
    memory: state === 'active' ? 180 * 2 ** 20 : null,
    cpu,
    health: state === 'active' ? { ok, detail: 'http 200', ms: 4, at: DEMO_NOW } : null,
    series: {
      cpu: state === 'active' ? wave(120, cpu, cpu / 2, id.length) : Array(120).fill(null),
      up: Array(120).fill(state === 'active' ? 1 : 0),
    },
  };
}

export function demoServiceDetail(id: string): ServiceDetail {
  const base = demoOverview().services.find((service) => service.id === id) ?? demoOverview().services[0];
  return {
    ...base,
    about: id === 'watcher' ? 'a Go service with a JSON status API' : '',
    url: null,
    actions: [
      { id: 'restart', label: 'restart', confirm: true },
      { id: 'stop', label: 'stop', confirm: true },
    ],
    every: 10,
    series: { ...base.series, memory: wave(120, 180 * 2 ** 20, 20 * 2 ** 20, 2) },
    panels: [
      { ...meta('watchers', 'watchers', 'stat'), endpoint: `/v1/panels/${id}/watchers`, value: 126 },
      { ...meta('failing', 'failing now', 'series'), endpoint: `/v1/panels/${id}/failing`, value: 2, series: wave(60, 1, 1.5, 7) },
      {
        ...meta('by-status', 'by last status', 'bars'),
        endpoint: `/v1/panels/${id}/by-status`,
        value: [
          { label: 'ok', value: 124 },
          { label: 'fetch_error', value: 2 },
        ],
      },
      {
        ...meta('status', 'through tailscale', 'status'),
        endpoint: `/v1/panels/${id}/status`,
        value: { ok: true, text: 'the site' },
      },
      {
        ...meta('recent', 'recent', 'list'),
        endpoint: `/v1/panels/${id}/recent`,
        value: ['2h · new listing on the watched page', '1d · price changed'],
      },
    ],
  };
}

export function demoLogs(): string[] {
  return [
    '2026-10-13T09:12:01 watcher[812]: checking 126 pages',
    '2026-10-13T09:12:04 watcher[812]: example-board: ok',
    '2026-10-13T09:13:44 watcher[812]: another-board: fetch_error: HTTP 404',
    '2026-10-13T09:14:01 watcher[812]: checking 126 pages',
  ];
}
