import { Code, ConnectError, createClient, type Interceptor } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { HostService } from '../gen/hostd/v1/host_pb';
import { SourceService } from '../gen/hostd/v1/source_pb';
import { GitHubError } from './github';
import { HostError, type HostSettings, type Overview, type Panel, type ServiceDetail } from './host';
import { toOverview, toPanel, toServiceDetail } from './hostProto';

/**
 * Talking to `hostd`: where it is and its token (in the keystore, beside the
 * GitHub token — the token is a key to a machine), and the calls the `host`
 * section makes. They are gRPC services (`proto/hostd/v1`) spoken in the
 * Connect protocol, which is plain HTTP/1.1 POSTs — what `fetch` can do, with
 * no TLS and no HTTP/2 needed on the tailnet. Each call carries the bearer
 * token and gives up after ten seconds.
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

const POINTS = 120;
const TIMEOUT = 10_000;

function clients(settings: HostSettings) {
  const bearer: Interceptor = (next) => (request) => {
    if (settings.token) request.header.set('Authorization', `Bearer ${settings.token}`);
    return next(request);
  };
  const transport = createConnectTransport({
    baseUrl: settings.url,
    useBinaryFormat: true,
    interceptors: [bearer],
  });
  return { host: createClient(HostService, transport), sources: createClient(SourceService, transport) };
}

/** One call, with the app's errors: the host's own words, or "could not reach". */
async function call<T>(settings: HostSettings, signal: AbortSignal | undefined, run: (c: ReturnType<typeof clients>) => Promise<T>): Promise<T> {
  try {
    return await run(clients(settings));
  } catch (error) {
    if (signal?.aborted) throw error;
    const failure = ConnectError.from(error);
    switch (failure.code) {
      case Code.Unauthenticated:
        throw new HostError('the host refused the token · copy it again from the host', 401);
      case Code.DeadlineExceeded:
      case Code.Canceled:
        throw new GitHubError('network', `could not reach ${settings.url}`);
      case Code.Unknown:
      case Code.Unimplemented:
        // No answer at all (fetch threw), or something that is not hostd.
        // Saved answers stay on screen through this, labelled with their
        // age, the same as GitHub being out of reach.
        if (failure.cause instanceof TypeError || /fetch|network/i.test(failure.rawMessage)) {
          throw new GitHubError('network', `could not reach ${settings.url}`);
        }
        throw new HostError(
          failure.code === Code.Unimplemented ? 'that answered, but it is not hostd · is this the old address?' : failure.rawMessage,
        );
    }
    throw new HostError(failure.rawMessage || `the host answered ${Code[failure.code]}`);
  }
}

const options = (signal?: AbortSignal) => ({ signal, timeoutMs: TIMEOUT });

/** Is anything there, is it `hostd`, and does it take the token: the connect form's check. */
export async function probe(settings: HostSettings, signal?: AbortSignal): Promise<string> {
  return call(settings, signal, async ({ host }) => {
    const health = await host.health({}, options(signal));
    if (!health.ok) throw new HostError('that answered, but it is not hostd');
    await host.getOverview({ points: 1 }, options(signal));
    return health.name || 'host';
  });
}

export const fetchOverview = (settings: HostSettings, signal?: AbortSignal): Promise<Overview> =>
  call(settings, signal, async ({ host }) => toOverview(await host.getOverview({ points: POINTS }, options(signal))));

export const fetchService = (settings: HostSettings, id: string, signal?: AbortSignal): Promise<ServiceDetail> =>
  call(settings, signal, async ({ host }) => {
    const detail = toServiceDetail(await host.getService({ id, points: POINTS }, options(signal)));
    if (!detail) throw new HostError(`the host has no service called ${id}`, 404);
    return detail;
  });

export const fetchLogs = (settings: HostSettings, id: string, lines: number, signal?: AbortSignal) =>
  call(settings, signal, async ({ host }) => {
    const logs = await host.getLogs({ serviceId: id, lines }, options(signal));
    return { lines: logs.lines, at: logs.at ? Number(logs.at.seconds) : Date.now() / 1000 };
  });

/** Reads one panel again now (its `key` is `scope/source/view`). */
export const refreshPanel = (settings: HostSettings, key: string): Promise<Panel> =>
  call(settings, undefined, async ({ sources }) => {
    const [scope, source, view] = key.split('/');
    const read = await sources.readSource({ scope, id: source, fresh: true, points: POINTS }, options());
    const found = read.reading?.views.find((candidate) => candidate.id === view);
    if (!found) throw new HostError(`the host has no panel ${key}`, 404);
    return toPanel(found);
  });

export async function runAction(settings: HostSettings, service: string, action: string): Promise<string> {
  const done = await call(settings, undefined, ({ host }) =>
    host.runAction({ serviceId: service, actionId: action }, { timeoutMs: 60_000 }),
  );
  return done.detail ? done.detail.split('\n')[0].slice(0, 120) : `${action} sent`;
}
