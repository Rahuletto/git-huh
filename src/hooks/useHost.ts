import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { demoOverview, demoServiceDetail, type HostSettings, type Overview, type ServiceDetail } from '../lib/host';
import { fetchOverview, fetchService, hostStore } from '../lib/hostClient';
import { useNav } from '../lib/nav';
import { pollWhileForeground } from '../lib/polling';
import { useRemote } from './useRemote';

/** The demo's host: drawn from `demoOverview`, never asked over the network. */
const DEMO: HostSettings = { url: 'demo', token: '' };

let shared: HostSettings | null | undefined;
const listeners = new Set<(value: HostSettings | null) => void>();

/**
 * Where the host is, shared by the section and the pages pushed from it, so
 * connecting on one is connected on all. `undefined` while the keystore is
 * being read.
 */
export function useHostSettings() {
  const nav = useNav();
  const [settings, setSettings] = useState<HostSettings | null | undefined>(shared);

  useEffect(() => {
    listeners.add(setSettings);
    if (shared === undefined) {
      hostStore.get().then((value) => {
        shared = value;
        listeners.forEach((listener) => listener(value));
      });
    }
    return () => {
      listeners.delete(setSettings);
    };
  }, []);

  const save = useCallback(async (next: HostSettings | null) => {
    if (next) await hostStore.set(next);
    else await hostStore.clear();
    shared = next;
    listeners.forEach((listener) => listener(next));
  }, []);

  return { settings: nav.demo ? DEMO : settings, save, demo: nav.demo };
}

/**
 * Re-asks every `seconds` while `active`: the host's numbers are live, and a
 * section that is not on screen should not keep a phone's radio awake.
 */
export function usePoll(reload: () => void, seconds: number, active: boolean) {
  useEffect(() => {
    if (!active) return;
    return pollWhileForeground(reload, seconds, {
      currentState: AppState.currentState,
      subscribe: (listener) => {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
    });
  }, [active, reload, seconds]);
}

export function useOverview(settings: HostSettings | null | undefined, active: boolean) {
  const demo = useMemo(() => (settings === DEMO ? demoOverview() : undefined), [settings]);
  const state = useRemote<Overview>(
    settings ? `${settings.url}|overview` : null,
    (signal) => fetchOverview(settings as HostSettings, signal),
    { cacheKey: settings && !demo ? 'host-overview' : null, demo },
  );
  usePoll(state.reload, state.status === 'ready' ? state.data.every : 10, active && !!settings && !demo &&
    state.status !== 'loading' && state.status !== 'idle' &&
    !(state.status === 'ready' && state.refreshing));
  return state;
}

export function useService(settings: HostSettings | null | undefined, id: string, active: boolean) {
  const demo = useMemo(() => (settings === DEMO ? demoServiceDetail(id) : undefined), [id, settings]);
  const state = useRemote<ServiceDetail>(
    settings ? `${settings.url}|service|${id}` : null,
    (signal) => fetchService(settings as HostSettings, id, signal),
    { cacheKey: settings && !demo ? `host-service-${id}` : null, demo },
  );
  usePoll(state.reload, state.status === 'ready' ? state.data.every : 10, active && !!settings && !demo &&
    state.status !== 'loading' && state.status !== 'idle' &&
    !(state.status === 'ready' && state.refreshing));
  return state;
}
