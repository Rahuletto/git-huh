import { Pressable, StyleSheet, View } from 'react-native';

import { bytes, duration, showValue, since, uptimeShare, verdict, type Overview, type ServiceState } from '../lib/host';
import { colors, fonts, space, themed } from '../theme';
import { Card } from './Card';
import { Meter, Series, StatusDot } from './HostPanel';
import { Data, Heading, Micro } from './Type';

/**
 * The pieces of the `host` page that are drawn the same whether the numbers
 * are live or a preview: the machine's cards and the rows of services.
 */

/** The machine itself: CPU over the last hour, memory, heat, disks. */
export function Machine({ data, width }: { data: Overview; width: number }) {
  const host = data.host;
  const inner = width - 36;
  return (
    <>
      <Card>
        <View style={styles.figures}>
          <Figure label="cpu" value={showValue(host.cpu, 'percent')} />
          <Figure label="memory" value={showValue(host.memory.percent, 'percent')} />
          {host.temperature != null && <Figure label="heat" value={`${Math.round(host.temperature)}°`} />}
          <Figure label="load" value={showValue(host.load[0] ?? 0, 'number')} />
        </View>
        <Micro style={styles.caption}>cpu · last {duration(host.series.cpu.length * data.every)}</Micro>
        <Series format={(peak) => showValue(peak, 'percent')} values={host.series.cpu} width={inner} />
        <Micro style={styles.caption}>
          memory · {bytes(host.memory.used)} of {bytes(host.memory.total)}
        </Micro>
        <Meter percent={host.memory.percent} />
      </Card>
      {host.disks.length > 0 && (
        <Card title="disks">
          <View style={styles.disks}>
            {host.disks.map((disk) => (
              <View key={disk.path} style={styles.disk}>
                <View style={styles.diskTop}>
                  <Data style={styles.diskPath}>{disk.path}</Data>
                  <Micro style={disk.percent >= 90 ? styles.bad : styles.dim}>
                    {Math.round(disk.percent)}% · {bytes(disk.total - disk.used)} free
                  </Micro>
                </View>
                <Meter percent={disk.percent} />
              </View>
            ))}
          </View>
        </Card>
      )}
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Heading style={styles.figureValue}>{value}</Heading>
      <Micro style={styles.dim}>{label}</Micro>
    </View>
  );
}

/**
 * One card, a row per service: a green or clay dot and a word, then what
 * matters about it in a line. With `onOpen`, a row pushes the service; in a
 * preview the rows are only drawn.
 */
export function ServiceRows({
  services,
  onOpen,
}: {
  services: ServiceState[];
  onOpen?: (service: ServiceState) => void;
}) {
  return (
    <Card padded={false}>
      {services.map((service, index) => {
        const word = verdict(service);
        const share = uptimeShare(service.series.up);
        const body = (
          <>
            <View style={styles.serviceTop}>
              <StatusDot ok={word.ok} />
              <Data numberOfLines={1} style={styles.serviceName}>
                {service.name}
              </Data>
              <Micro style={word.ok === false ? styles.bad : styles.dim}>{word.word}</Micro>
            </View>
            <Micro numberOfLines={1} style={styles.serviceMeta}>
              {[
                service.state === 'active' && service.cpu != null ? `cpu ${showValue(service.cpu, 'percent')}` : null,
                service.memory ? bytes(service.memory) : null,
                service.since ? `for ${since(service.since)}` : null,
                service.state === 'active' && share != null && share < 100 ? `${share}% up lately` : null,
                service.health && !service.health.ok ? service.health.detail : null,
              ]
                .filter(Boolean)
                .join(' · ') || service.sub || service.state}
            </Micro>
          </>
        );
        const style = [styles.service, index > 0 && styles.serviceLine];
        return onOpen ? (
          <Pressable
            accessibilityHint="opens its graphs, logs and actions"
            accessibilityRole="button"
            key={service.id}
            onPress={() => onOpen(service)}
            style={style}
          >
            {body}
          </Pressable>
        ) : (
          <View key={service.id} style={style}>
            {body}
          </View>
        );
      })}
    </Card>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    dim: { color: colors.ink40 },
    bad: { color: colors.no },
    figures: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    figure: { gap: 2 },
    figureValue: { fontFamily: fonts.light, fontSize: 24, lineHeight: 30 },
    caption: { color: colors.ink40, marginBottom: 4, marginTop: 12 },
    disks: { gap: 12 },
    disk: { gap: 6 },
    diskTop: { flexDirection: 'row', justifyContent: 'space-between' },
    diskPath: { color: colors.ink, fontSize: 12 },
    service: { gap: 4, paddingHorizontal: space.card, paddingVertical: 13 },
    serviceLine: { borderTopColor: colors.hair, borderTopWidth: 1 },
    serviceTop: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    serviceName: { color: colors.ink, flex: 1, fontFamily: fonts.monoMedium, fontSize: 13 },
    serviceMeta: { color: colors.ink70, paddingLeft: 16 },
  }),
);
