import { useState } from 'react';
import { StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { Card } from '../components/Card';
import { HostPanel } from '../components/HostPanel';
import { Machine, ServiceRows } from '../components/HostParts';
import { IconButton, IconPill } from '../components/Icon';
import { Body, Data, Label, Micro } from '../components/Type';
import { useHostSettings, useOverview } from '../hooks/useHost';
import { GitHubError } from '../lib/github';
import {
  blockedInTheClear,
  duration,
  normalizeUrl,
  verdict,
  type HostSettings,
} from '../lib/host';
import { probe } from '../lib/hostClient';
import { useNav } from '../lib/nav';
import { explain } from '../lib/rest';
import { savedAge } from '../lib/store';
import { colors, fonts, radii, space, themed } from '../theme';
import { HostIntro } from './HostIntro';
import { Block, Page, ScreenHead } from './shared';

/**
 * `host` — a machine of yours, from the phone: is it up, how hard is it
 * working, and is everything you run on it answering.
 *
 * The numbers come from `hostd`, a small companion server you run on that
 * machine and reach over your tailnet. It watches the services its JSON
 * config names, keeps their logs and their CPU, and serves any panels the
 * config defines; this page draws what it is given and knows nothing about
 * any service in particular. A service row pushes its own page: its graphs,
 * its panels, its logs and what can be done to it.
 */
export function HostScreen({ active }: { active: boolean }) {
  const { settings, save, demo } = useHostSettings();
  const [editing, setEditing] = useState(false);

  if (settings === undefined) {
    return (
      <Page>
        <Label style={styles.note}>reading where the host is…</Label>
      </Page>
    );
  }

  if (settings === null || editing) {
    return (
      <Page blocks>
        <Block>
          <ScreenHead left="host" right={settings ? 'change' : 'not connected'} />
          {settings === null && <HostIntro active={active} />}
          <Connect
            current={settings}
            onCancel={settings ? () => setEditing(false) : undefined}
            onDisconnect={
              settings
                ? () => {
                    save(null).catch(() => {});
                    setEditing(false);
                  }
                : undefined
            }
            onSaved={(next) => {
              save(next).catch(() => {});
              setEditing(false);
            }}
          />
        </Block>
      </Page>
    );
  }

  return <Connected active={active} demo={demo} onEdit={() => setEditing(true)} settings={settings} />;
}

function Connected({
  settings,
  active,
  demo,
  onEdit,
}: {
  settings: HostSettings;
  active: boolean;
  demo: boolean;
  onEdit: () => void;
}) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const cardWidth = width - space.gutter * 2;
  const state = useOverview(settings, active);

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <Page>
        <Label style={styles.note}>asking {settings.url.replace(/^https?:\/\//, '')}…</Label>
      </Page>
    );
  }

  if (state.status === 'error') {
    const unreachable = state.error instanceof GitHubError && state.error.kind === 'network';
    return (
      <Page blocks>
        <Block>
          <ScreenHead
            action={demo ? undefined : { label: 'change', hint: 'the address and the token', onPress: onEdit }}
            left="host"
            right="no answer"
          />
          <Card>
            <Body style={styles.error}>
              {unreachable
                ? `nothing answered at ${settings.url} · is the machine on, and is this phone on the tailnet`
                : explain(state.error, 'that')}
            </Body>
            <IconPill icon="refresh" label="try again" onPress={state.reload} style={styles.retry} />
          </Card>
        </Block>
      </Page>
    );
  }

  const data = state.data;
  const up = data.services.filter((service) => verdict(service).ok).length;

  return (
    <Page blocks>
      <Block>
        <ScreenHead
          action={demo ? undefined : { label: 'change', hint: 'the address and the token', onPress: onEdit }}
          left={data.name}
          right={`up ${duration(data.host.uptime)}`}
        />
        {state.offline && state.savedAt != null && (
          <Micro style={styles.dim}>offline · saved {savedAge(state.savedAt)}</Micro>
        )}
        <Machine data={data} width={cardWidth} />
      </Block>

      <Block>
        <ScreenHead left="services" right={`${up} of ${data.services.length} up`} />
        {data.services.length === 0 && (
          <Label style={styles.note}>no services in the host&apos;s config yet</Label>
        )}
        <ServiceRows
          onOpen={(service) => nav.open({ kind: 'service', id: service.id, name: service.name })}
          services={data.services}
        />
      </Block>

      {data.panels.length > 0 && (
        <Block>
          <ScreenHead left="panels" right={`${data.panels.length}`} />
          {data.panels.map((panel) => (
            <HostPanel key={panel.id} panel={panel} width={cardWidth} />
          ))}
        </Block>
      )}
    </Page>
  );
}

/**
 * Where the host is: its address on the tailnet and the token `hostd` made
 * on its first run. Checked before it is saved, so a typo is found here and
 * not as an empty page.
 */
function Connect({
  current,
  onSaved,
  onCancel,
  onDisconnect,
}: {
  current: HostSettings | null;
  onSaved: (settings: HostSettings) => void;
  onCancel?: () => void;
  onDisconnect?: () => void;
}) {
  const [url, setUrl] = useState(current?.url ?? '');
  const [token, setToken] = useState(current?.token ?? '');
  const [phase, setPhase] = useState<{ kind: 'idle' | 'checking' } | { kind: 'failed'; note: string }>({
    kind: 'idle',
  });
  const normal = normalizeUrl(url);

  const connect = async () => {
    if (!normal) return;
    setPhase({ kind: 'checking' });
    const next = { url: normal, token: token.trim() };
    try {
      await probe(next);
      onSaved(next);
    } catch (error) {
      const unreachable = error instanceof GitHubError && error.kind === 'network';
      setPhase({
        kind: 'failed',
        note: unreachable
          ? blockedInTheClear(normal)
            ? 'nothing answered · use the machine’s tailnet name (….ts.net), which this build may talk to without https'
            : `nothing answered at ${normal}`
          : explain(error, 'connecting'),
      });
    }
  };

  return (
    // A first visit has the steps just above it (`HostIntro`); a change does not.
    <Card title={current ? undefined : 'connect'}>
      {current && (
        <Body style={styles.lede}>
          run <Data style={styles.code}>hostd</Data> on the machine and give its tailnet
          address here. it prints the token the first time it starts.
        </Body>
      )}
      <Micro style={styles.field}>address</Micro>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
        onChangeText={setUrl}
        placeholder="http://desk.your-tailnet.ts.net:8796"
        placeholderTextColor={colors.ink40}
        style={styles.input}
        value={url}
      />
      <Micro style={styles.field}>token</Micro>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setToken}
        placeholder="from ~/.local/state/hostd/token"
        placeholderTextColor={colors.ink40}
        secureTextEntry
        style={styles.input}
        value={token}
      />
      <View style={styles.formRow}>
        <IconPill
          icon="server"
          label={phase.kind === 'checking' ? 'checking…' : 'connect'}
          on
          onPress={connect}
        />
        {onCancel && <IconPill icon="close" label="cancel" onPress={onCancel} />}
        {onDisconnect && (
          <IconButton icon="delete" label="forget this host" onPress={onDisconnect} />
        )}
      </View>
      {phase.kind === 'failed' && <Micro style={styles.bad}>{phase.note}</Micro>}
    </Card>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    note: {
      paddingVertical: 24,
      textAlign: 'center',
    },
    dim: {
      color: colors.ink40,
    },
    bad: {
      color: colors.no,
    },
    error: {
      color: colors.no,
    },
    retry: {
      marginTop: 12,
    },
    lede: {
      color: colors.ink70,
    },
    code: {
      color: colors.ink,
      fontSize: 12,
    },
    field: {
      color: colors.ink40,
      marginBottom: 4,
      marginTop: 14,
    },
    input: {
      backgroundColor: colors.canvas,
      borderColor: colors.hair,
      borderRadius: radii.tile,
      borderWidth: 1,
      color: colors.ink,
      fontFamily: fonts.mono,
      fontSize: 13,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    formRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 6,
      marginTop: 16,
    },
  }),
);
