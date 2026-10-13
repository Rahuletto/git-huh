import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { GitHubError } from './github';
import {
  HostError,
  type HostSettings,
  type Overview,
  type Panel,
  type ServiceDetail,
} from './host';

/**
 * Talking to `hostd`: where it is and its token (in the keystore, beside the
 * GitHub token — the token is a key to a machine), and the five requests the
 * `host` section makes. Each request carries the bearer token and gives up
 * after ten seconds.
 */

const KEY = 'host_settings';
const memory = { value: null as string | null };
const secure = Platform.OS !== 'web';

export const hostStore = {
  async get(): Promise<HostSettings | null> {
    const raw = secure ? await SecureStore.getItemAsync(KEY) : memory.value;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<HostSettings>;
      return parsed.url ? { url: parsed.url, token: parsed.token ?? '' } : null;
    } catch {
      return null;
    }
  },
  async set(settings: HostSettings): Promise<void> {
    const raw = JSON.stringify(settings);
    if (secure) await SecureStore.setItemAsync(KEY, raw);
    else memory.value = raw;
  },
  async clear(): Promise<void> {
    if (secure) await SecureStore.deleteItemAsync(KEY);
    else memory.value = null;
  },
};

async function call<T>(
  settings: HostSettings,
  path: string,
  { method = 'GET', signal }: { method?: 'GET' | 'POST'; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  signal?.addEventListener('abort', () => controller.abort());
  let response: Response;
  try {
    response = await fetch(`${settings.url}${path}`, {
      method,
      headers: settings.token ? { Authorization: `Bearer ${settings.token}` } : {},
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    // Saved answers stay on screen through this, labelled with their age —
    // the same as GitHub being out of reach.
    throw new GitHubError('network', `could not reach ${settings.url}`);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const said = (body as { error?: string } | null)?.error;
    if (response.status === 401) throw new HostError('the host refused the token · copy it again from the host', 401);
    throw new HostError(said ?? `the host answered ${response.status}`, response.status);
  }
  if (body == null) throw new HostError('the host answered with something that is not json');
  return body as T;
}

/** Is anything there, and is it `hostd`: the check the connect form makes. */
export async function probe(settings: HostSettings, signal?: AbortSignal): Promise<string> {
  const manifest = await call<{ hostd?: number; name?: string; error?: string | null }>(settings, '/v1', { signal });
  if (!manifest.hostd) throw new HostError('that answered, but it is not hostd');
  return manifest.name ?? 'host';
}

export const fetchOverview = (settings: HostSettings, signal?: AbortSignal) =>
  call<Overview>(settings, '/v1/overview?points=120', { signal });

export const fetchService = (settings: HostSettings, id: string, signal?: AbortSignal) =>
  call<ServiceDetail>(settings, `/v1/services/${encodeURIComponent(id)}?points=120`, { signal });

export const fetchLogs = (settings: HostSettings, id: string, lines: number, signal?: AbortSignal) =>
  call<{ lines: string[]; at: number }>(
    settings,
    `/v1/services/${encodeURIComponent(id)}/logs?lines=${lines}`,
    { signal },
  );

export const refreshPanel = (settings: HostSettings, endpoint: string) =>
  call<Panel>(settings, `${endpoint}?points=120`, { method: 'POST' });

export async function runAction(settings: HostSettings, service: string, action: string): Promise<string> {
  const done = await call<{ ok?: boolean; detail?: string }>(
    settings,
    `/v1/services/${encodeURIComponent(service)}/actions/${encodeURIComponent(action)}`,
    { method: 'POST' },
  );
  return done.detail ? done.detail.split('\n')[0].slice(0, 120) : `${action} sent`;
}
