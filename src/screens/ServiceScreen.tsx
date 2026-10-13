import { useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Card } from '../components/Card';
import { Composer } from '../components/Composer';
import { HostPanel, LogLines, Series, StatusDot } from '../components/HostPanel';
import { IconButton, IconPill } from '../components/Icon';
import { OverlayFrame, SavedNote } from '../components/Overlay';
import { Body, Data, Heading, Label, Micro } from '../components/Type';
import { useHostSettings, useService } from '../hooks/useHost';
import { useRemote } from '../hooks/useRemote';
import { bytes, demoLogs, duration, showValue, since, uptimeShare, verdict, type HostSettings } from '../lib/host';
import { fetchLogs, runAction } from '../lib/hostClient';
import { useNav } from '../lib/nav';
import { explain } from '../lib/rest';
import { colors, space, themed } from '../theme';

/** How many log lines a page asks for, and the step `more` adds. */
const LOG_STEP = 120;
/** When the demo's log was read: any fixed moment does. */
const DEMO_AT = 1_760_000_000;

/**
 * One service on the host, pushed from the `host` section: whether it is up
 * and answering, its CPU and memory over the last hour, what can be done to
 * it (only what the host's config allows), the panels its config defines,
 * and the end of its log.
 */
export function ServiceScreen({ id, name }: { id: string; name: string }) {
  const nav = useNav();
  const { settings } = useHostSettings();
  const { width } = useWindowDimensions();
  const cardWidth = width - space.gutter * 2;
  const state = useService(settings, id, true);
  const service = state.status === 'ready' ? state.data : null;

  return (
    <OverlayFrame onBack={nav.close} where={`host · ${name}`}>
      {state.status === 'ready' && <SavedNote offline={state.offline} savedAt={state.savedAt} />}
      {(state.status === 'loading' || state.status === 'idle') && (
        <Label style={styles.note}>asking the host about {name}…</Label>
      )}
      {state.status === 'error' && (
        <View style={styles.errorStack}>
          <Body style={styles.bad}>{explain(state.error, 'reading it')}</Body>
          <IconPill icon="refresh" label="try again" onPress={state.reload} />
        </View>
      )}

      {service && settings && (
        <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <Card>
            <View style={styles.titleTop}>
              <StatusDot ok={verdict(service).ok} />
              <Micro style={verdict(service).ok === false ? styles.bad : styles.dim}>
                {verdict(service).word}
                {service.sub ? ` · ${service.sub}` : ''}
              </Micro>
              <View style={styles.flex} />
              {service.url ? (
                <IconButton
                  icon="external"
                  label="open it"
                  onPress={() => Linking.openURL(service.url ?? '').catch(() => {})}
                />
              ) : null}
              <IconButton icon="refresh" label="read it again" onPress={state.reload} />
            </View>
            <Heading style={styles.title}>{service.name}</Heading>
            {service.about ? <Body style={styles.about}>{service.about}</Body> : null}
            <Micro style={styles.facts}>
              {[
                service.since ? `up for ${since(service.since)}` : null,
                service.pid ? `pid ${service.pid}` : null,
                service.restarts ? `${service.restarts} restarts` : null,
                service.health ? `${service.health.ok ? 'answering' : 'not answering'} · ${service.health.detail} · ${service.health.ms} ms · ${since(service.health.at)} ago` : null,
                service.detail ?? null,
              ]
                .filter(Boolean)
                .join('\n')}
            </Micro>
          </Card>

          {service.actions.length > 0 && (
            <Composer
              actions={service.actions.map((action) => ({
                key: action.id,
                label: action.label,
                confirm: action.confirm ? `${action.label} it?` : undefined,
                icon:
                  action.id === 'restart'
                    ? ('restart' as const)
                    : action.id === 'stop'
                      ? ('stop' as const)
                      : action.id === 'start'
                        ? ('play' as const)
                        : ('check' as const),
              }))}
              bare
              demo={settings.url === 'demo'}
              doing="that"
              onSubmit={async (key) => {
                const note = await runAction(settings, id, key);
                setTimeout(state.reload, 1500);
                return note;
              }}
            />
          )}

          <Card title="cpu" figure={service.cpu != null ? showValue(service.cpu, 'percent') : '—'}>
            <Series format={(peak) => showValue(peak, 'percent')} values={service.series.cpu} width={cardWidth - 36} />
          </Card>
          {service.series.memory && (
            <Card title="memory" figure={bytes(service.memory)}>
              <Series format={bytes} values={service.series.memory} width={cardWidth - 36} />
            </Card>
          )}
          <UpRow up={service.series.up} every={service.every} />

          {service.panels.map((panel) => (
            <HostPanel key={panel.id} panel={panel} width={cardWidth} />
          ))}

          <Logs id={id} settings={settings} />
        </ScrollView>
      )}
    </OverlayFrame>
  );
}

/** Up or down at each reading, as a row of dots: a ghost is a reading it was down for. */
function UpRow({ up, every }: { up: (number | null)[]; every: number }) {
  const share = uptimeShare(up);
  if (share == null) return null;
  return (
    <Card title="answering" figure={`${share}% · last ${duration(up.length * every)}`}>
      <View style={styles.upRow}>
        {squeezeUp(up, 40).map((value, index) => (
          <View key={index} style={[styles.upCell, value ? styles.upOn : styles.upOff]} />
        ))}
      </View>
    </Card>
  );
}

/** Down wins: a slot is down if any reading in it was. */
function squeezeUp(values: (number | null)[], slots: number): number[] {
  if (values.length === 0) return [];
  const out: number[] = [];
  const count = Math.min(slots, values.length);
  for (let slot = 0; slot < count; slot++) {
    const start = Math.floor((slot * values.length) / count);
    const end = Math.max(start + 1, Math.floor(((slot + 1) * values.length) / count));
    out.push(values.slice(start, end).every((value) => value != null && value > 0) ? 1 : 0);
  }
  return out;
}

function Logs({ id, settings }: { id: string; settings: HostSettings }) {
  const [lines, setLines] = useState(LOG_STEP);
  const demo = useMemo(
    () => (settings.url === 'demo' ? { lines: demoLogs(), at: DEMO_AT } : undefined),
    [settings.url],
  );
  const logs = useRemote(
    `${settings.url}|logs|${id}|${lines}`,
    (signal) => fetchLogs(settings, id, lines, signal),
    { demo },
  );

  return (
    <Card title="log" figure={logs.status === 'ready' ? `${logs.data.lines.length} lines · newest first` : undefined}>
      {logs.status === 'loading' && <Micro style={styles.dim}>reading the log…</Micro>}
      {logs.status === 'error' && <Micro style={styles.bad}>{explain(logs.error, 'reading the log')}</Micro>}
      {logs.status === 'ready' &&
        (logs.data.lines.length === 0 ? (
          <Micro style={styles.dim}>no log for this one · give it `logs` in the host&apos;s config</Micro>
        ) : (
          <LogLines lines={logs.data.lines} />
        ))}
      <View style={styles.logTools}>
        <IconPill icon="refresh" label="newest" onPress={logs.reload} />
        {logs.status === 'ready' && logs.data.lines.length >= lines && (
          <IconPill icon="expand" label="further back" onPress={() => setLines(lines + LOG_STEP)} />
        )}
        {logs.status === 'ready' && (
          <Data style={styles.dim}>read {since(logs.data.at)} ago</Data>
        )}
      </View>
    </Card>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    page: {
      gap: 10,
      paddingBottom: 30,
      paddingHorizontal: space.gutter,
      paddingTop: 6,
    },
    note: {
      marginTop: 26,
      textAlign: 'center',
    },
    errorStack: {
      alignItems: 'center',
      gap: 14,
      marginTop: 30,
      paddingHorizontal: space.gutter,
    },
    dim: {
      color: colors.ink40,
    },
    bad: {
      color: colors.no,
    },
    flex: {
      flex: 1,
    },
    titleTop: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    title: {
      fontSize: 18,
      lineHeight: 24,
      marginTop: 10,
    },
    about: {
      color: colors.ink70,
      marginTop: 4,
    },
    facts: {
      color: colors.ink70,
      lineHeight: 16,
      marginTop: 10,
    },
    upRow: {
      flexDirection: 'row',
      gap: 3,
    },
    // Fill and border change together: see the corner-radius trap.
    upCell: {
      borderRadius: 3,
      borderWidth: 1,
      flex: 1,
      height: 8,
    },
    upOn: {
      backgroundColor: colors.ink,
      borderColor: colors.ink,
    },
    upOff: {
      backgroundColor: colors.no,
      borderColor: colors.no,
    },
    logTools: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
  }),
);
