import { StyleSheet, View } from 'react-native';

import { isBadLine, showValue, squeeze, tidyLogLine, type Panel } from '../lib/host';
import { colors, fonts, themed } from '../theme';
import { Card } from './Card';
import { DotRow } from './DotRow';
import { Data, Heading, Label, Micro } from './Type';

/** How many dots a reading over time is squeezed into. */
const SLOTS = 40;

/**
 * A reading over time as the widget's dots: the last readings squeezed into
 * forty slots, each the highest it saw, the peak squared off with its number.
 * A slot with no reading (the service was down, the host was off) is a ghost.
 */
export function Series({
  values,
  width,
  height = 18,
  format,
}: {
  values: readonly (number | null)[];
  width: number;
  height?: number;
  format?: (value: number) => string;
}) {
  const slots = squeeze(values, SLOTS).map((value) => value ?? 0);
  if (slots.length === 0) return <Micro style={styles.dim}>no readings yet</Micro>;
  const peak = Math.max(...slots);
  return (
    <View>
      <DotRow height={height} peakLabel={false} values={slots} width={width} />
      <View style={styles.seriesFoot}>
        <Micro style={styles.dim}>{format ? `peak ${format(peak)}` : ''}</Micro>
        <Micro style={styles.dim}>now</Micro>
      </View>
    </View>
  );
}

/**
 * A share as a row of dots, lit up to it: a disk, a memory, a panel with a
 * `max`. A count is lit cells in a row of ghosts (LANGUAGE §8).
 */
export function Meter({ percent, cells = 24 }: { percent: number; cells?: number }) {
  const lit = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells);
  return (
    <View
      accessibilityLabel={`${Math.round(percent)} percent`}
      // A long row spans its card; a short one (a few steps) stays together.
      style={[styles.meter, cells < 20 && styles.meterShort]}
    >
      {Array.from({ length: cells }, (_, index) => (
        <View
          key={index}
          style={[styles.cell, index < lit ? styles.cellOn : styles.cellOff, index === lit - 1 && percent >= 90 && styles.cellPeak]}
        />
      ))}
    </View>
  );
}

/** A green or clay dot beside a word — never colour alone (LANGUAGE §3). */
export function StatusDot({ ok }: { ok: boolean | null }) {
  return (
    <View
      style={[
        styles.status,
        { backgroundColor: ok == null ? colors.ink40 : ok ? colors.yes : colors.no },
        { borderColor: ok == null ? colors.ink40 : ok ? colors.yes : colors.no },
      ]}
    />
  );
}

/**
 * One panel from the host's config, drawn by its kind. The app does not know
 * what any panel is about; the host's JSON says what it is called, what kind
 * it is and how to show its number, and this draws that.
 */
export function HostPanel({ panel, width }: { panel: Panel; width: number }) {
  const inner = width - 36;
  const figure = panel.at ? undefined : panel.pending ? 'waiting' : undefined;
  return (
    <Card figure={figure} title={panel.title}>
      <PanelBody inner={inner} panel={panel} />
    </Card>
  );
}

function PanelBody({ panel, inner }: { panel: Panel; inner: number }) {
  if (panel.error) return <Micro style={styles.error}>{panel.error}</Micro>;
  if (panel.pending && panel.value === undefined) {
    return <Micro style={styles.dim}>the host has not read this yet</Micro>;
  }
  const value = panel.value;

  switch (panel.kind) {
    case 'stat':
    case 'series': {
      const number = typeof value === 'number' || typeof value === 'string' || value == null ? value : null;
      return (
        <View style={styles.stack}>
          <Heading style={styles.big}>{showValue(number, panel.display, panel.unit)}</Heading>
          {panel.max != null && typeof number === 'number' && (
            <Meter percent={(100 * number) / panel.max} />
          )}
          {panel.series && panel.series.length > 0 && (
            <Series
              format={(peak) => showValue(peak, panel.display, panel.unit)}
              values={panel.series}
              width={inner}
            />
          )}
        </View>
      );
    }
    case 'status': {
      const status = value as { ok: boolean; text: string } | null;
      return (
        <View style={styles.row}>
          <StatusDot ok={status?.ok ?? null} />
          <Data numberOfLines={2} style={styles.flex}>
            {status ? `${status.ok ? 'ok' : 'not ok'} · ${status.text || '—'}` : '—'}
          </Data>
        </View>
      );
    }
    case 'bars': {
      const bars = Array.isArray(value) ? (value as { label: string; value: number }[]) : [];
      const top = Math.max(1, ...bars.map((bar) => bar.value));
      if (bars.length === 0) return <Micro style={styles.dim}>nothing to count</Micro>;
      return (
        <View style={styles.stack}>
          {bars.map((bar) => (
            <View key={bar.label} style={styles.barRow}>
              <Data numberOfLines={1} style={styles.barLabel}>
                {bar.label}
              </Data>
              <View style={styles.flex}>
                <Meter cells={16} percent={(100 * bar.value) / top} />
              </View>
              <Data style={styles.barValue}>{showValue(bar.value, 'number')}</Data>
            </View>
          ))}
        </View>
      );
    }
    case 'table': {
      const table = value as { columns: string[]; rows: string[][]; total: number } | null;
      if (!table || table.rows.length === 0) return <Micro style={styles.dim}>nothing here right now</Micro>;
      // Every column but the last as wide as its longest cell (to a point),
      // so the columns line up from row to row; the last takes the rest.
      const count = Math.max(table.columns.length, ...table.rows.map((row) => row.length));
      const widths = Array.from({ length: count }, (_, index) =>
        index === count - 1
          ? undefined
          : Math.min(
              18,
              Math.max(...[table.columns[index] ?? '', ...table.rows.map((row) => row[index] ?? '')].map((cell) => cell.length)),
            ) * 7.3 + 4,
      );
      const cellStyle = (index: number) => (widths[index] == null ? styles.cellLast : { width: widths[index] });
      return (
        <View>
          {table.columns.length > 0 && (
            <View style={styles.tableRow}>
              {table.columns.map((column, index) => (
                <Micro key={index} numberOfLines={1} style={[styles.dim, cellStyle(index)]}>
                  {column}
                </Micro>
              ))}
            </View>
          )}
          {table.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={[styles.tableRow, styles.tableLine]}>
              {row.map((cell, index) => (
                <Data
                  key={index}
                  numberOfLines={index === row.length - 1 ? 3 : 1}
                  style={[styles.tableCell, cellStyle(index)]}
                >
                  {cell}
                </Data>
              ))}
            </View>
          ))}
          {table.total > table.rows.length && (
            <Micro style={styles.dim}>
              {table.rows.length} of {table.total}
            </Micro>
          )}
        </View>
      );
    }
    case 'list':
    case 'log': {
      const lines = Array.isArray(value) ? (value as string[]) : value == null ? [] : [String(value)];
      if (lines.length === 0) return <Micro style={styles.dim}>nothing here · all clear</Micro>;
      if (panel.kind === 'log') return <LogLines lines={lines} />;
      return (
        <View>
          {lines.map((line, index) => (
            <Data key={index} numberOfLines={2} style={[styles.listLine, index > 0 && styles.tableLine]}>
              {line}
            </Data>
          ))}
        </View>
      );
    }
  }
}

/**
 * Log lines, newest first, wrapped to the phone: the time on the left in the
 * annotation weight, the line after it, and a line that reports a failure in
 * clay beside its own words.
 */
export function LogLines({ lines }: { lines: string[] }) {
  const tidy = lines.map(tidyLogLine).reverse();
  return (
    <View style={styles.log}>
      {tidy.map((line, index) => (
        <View key={index} style={styles.logRow}>
          {line.time ? <Label style={styles.logTime}>{line.time}</Label> : null}
          <Label selectable style={[styles.logLine, isBadLine(line.text) && styles.logBad]}>
            {line.text}
          </Label>
        </View>
      ))}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    stack: {
      gap: 8,
    },
    big: {
      fontFamily: fonts.light,
      fontSize: 28,
      lineHeight: 34,
    },
    dim: {
      color: colors.ink40,
    },
    error: {
      color: colors.no,
    },
    flex: {
      flex: 1,
    },
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    seriesFoot: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    meter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    meterShort: {
      gap: 5,
      justifyContent: 'flex-start',
    },
    // Fill and border change together: see the corner-radius trap.
    cell: {
      borderRadius: 3,
      borderWidth: 1,
      height: 6,
      width: 6,
    },
    cellOn: {
      backgroundColor: colors.ink,
      borderColor: colors.ink,
    },
    cellOff: {
      backgroundColor: colors.ink20,
      borderColor: colors.ink20,
    },
    cellPeak: {
      borderRadius: 1,
    },
    status: {
      borderRadius: 4,
      borderWidth: 1,
      height: 8,
      width: 8,
    },
    barRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
    },
    barLabel: {
      color: colors.ink70,
      fontSize: 11,
      width: 96,
    },
    barValue: {
      color: colors.ink,
      fontSize: 11,
      minWidth: 30,
      textAlign: 'right',
    },
    tableRow: {
      flexDirection: 'row',
      gap: 10,
      paddingVertical: 6,
    },
    tableLine: {
      borderTopColor: colors.hair,
      borderTopWidth: 1,
    },
    tableCell: {
      color: colors.ink,
      fontSize: 11,
    },
    cellLast: {
      flex: 1,
    },
    listLine: {
      color: colors.ink,
      fontSize: 11,
      paddingVertical: 6,
    },
    log: {
      backgroundColor: colors.recess,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    logRow: {
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 2,
    },
    logTime: {
      color: colors.ink40,
      fontSize: 10,
      lineHeight: 15,
    },
    logLine: {
      color: colors.ink70,
      flex: 1,
      fontSize: 10,
      lineHeight: 15,
    },
    logBad: {
      color: colors.no,
    },
  }),
);
