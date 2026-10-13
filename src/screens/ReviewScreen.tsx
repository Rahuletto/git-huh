import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { Card } from '../components/Card';
import { dot } from '../components/DotField';

import { Data, Heading, Label } from '../components/Type';
import { cycleStats, type Activity, type PullDetail } from '../lib/activity';
import { useNav } from '../lib/nav';
import { colors, space, themed } from '../theme';
import { Block, ScreenHead } from './shared';

const ROW = 30;
/** Spacing of the dots along a pull request's track. */
const DOT_PITCH = 9;
/** The number on the left of a row and its time on the right. */
const NUMBER_WIDTH = 44;
const TOOK_WIDTH = 40;

/**
 * Derived from pin10's rainfall chart: one row per pull request, a run of
 * dots for how long it stayed open, a ring where the first review landed, and
 * a single dashed rule for the median carried down every row. Each row says
 * which pull request it is and how long it took at its two ends, and opens
 * it — a chart in one card and its key in another made you match them up
 * by counting.
 */
export function ReviewScreen({
  activity,
  loading,
}: {
  activity: Activity;
  loading: boolean;
}) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const trackWidth = width - space.gutter * 2 - space.card * 2 - NUMBER_WIDTH - TOOK_WIDTH - 16;
  const stats = cycleStats(activity.pulls);

  // Oldest first, and only the ones that actually closed — an open PR has no
  // cycle time yet and would draw a bar to infinity.
  const rows = activity.pulls
    .filter((pr) => pr.mergedAt)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-14);

  const hoursOf = (pr: PullDetail) =>
    (Date.parse(pr.mergedAt ?? pr.createdAt) - Date.parse(pr.createdAt)) / 3_600_000;
  const longest = Math.max(1, ...rows.map(hoursOf));
  const median = stats.medianCycleHours;
  const medianX = Math.min(1, median / longest) * trackWidth;

  return (
    <Block>
      <ScreenHead
        left="how long it took"
        right={rows.length > 0 ? `${rows.length} merged` : ''}
      />

      {loading && rows.length === 0 && <Label style={styles.note}>reading pull requests…</Label>}

      {!loading && rows.length === 0 && (
        <Label style={styles.note}>nothing merged in this window</Label>
      )}

      {rows.length > 0 && (
        <>
          <View style={styles.summary}>
            <Stat label="median cycle" value={duration(median)} />
            <Stat label="first review" value={duration(stats.medianReviewWaitHours)} />
            <Stat label="merge rate" value={`${Math.round(stats.mergeRate * 100)}%`} />
          </View>

          <Card style={styles.chart}>
            {rows.map((pr) => {
              const hours = hoursOf(pr);
              const barWidth = Math.max(DOT_PITCH, (hours / longest) * trackWidth);
              const slow = hours > median;
              // Open to merge as a run of the widget's dots, one every few
              // points; the last one is the merge, and a slow one squares off.
              const count = Math.max(1, Math.round(barWidth / DOT_PITCH));
              let d = '';
              for (let i = 0; i < count; i++) {
                const last = i === count - 1;
                d += dot(i * DOT_PITCH + DOT_PITCH / 2, ROW / 2, last ? 8 : 5, last && slow);
              }
              const wait = pr.firstReviewAt
                ? (Date.parse(pr.firstReviewAt) - Date.parse(pr.createdAt)) / 3_600_000
                : 0;
              return (
                <Pressable
                  accessibilityHint="opens the pull request"
                  accessibilityLabel={`${pr.repo} number ${pr.number}, open ${duration(hours)}`}
                  accessibilityRole="button"
                  key={`${pr.repo}#${pr.number}`}
                  onPress={() => nav.open({ kind: 'pull', repo: pr.repo, number: pr.number })}
                  style={styles.row}
                >
                  <Data numberOfLines={1} style={styles.number}>
                    #{pr.number}
                  </Data>
                  <Svg height={ROW} width={trackWidth}>
                    {/* The median, carried down every row — pin10's centre
                        line. 30 is five whole dashes, so the rows join up. */}
                    <Line
                      stroke={colors.ink40}
                      strokeDasharray="2 4"
                      strokeWidth={1}
                      x1={medianX}
                      x2={medianX}
                      y1={0}
                      y2={ROW}
                    />
                    <Path d={d} fill={colors.ink} opacity={slow ? 1 : 0.5} />
                    {/* Where the first review actually landed. */}
                    {wait > 0 && (
                      <Circle
                        cx={Math.min(wait / longest, 1) * trackWidth}
                        cy={ROW / 2}
                        fill={colors.card}
                        r={4.5}
                        stroke={colors.ink}
                        strokeWidth={1.5}
                      />
                    )}
                  </Svg>
                  <Data style={styles.took}>{duration(hours)}</Data>
                </Pressable>
              );
            })}
          </Card>

          <View style={styles.legend}>
            {['dots · open to merge', 'ring · first review', 'dashed · median'].map((item) => (
              <Label key={item}>{item}</Label>
            ))}
          </View>
        </>
      )}
    </Block>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Heading style={styles.statValue}>{value}</Heading>
      <Label>{label}</Label>
    </View>
  );
}

/** Hours read badly past a day or two; switch units rather than scaling. */
function duration(hours: number): string {
  if (hours <= 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

const styles = themed(() =>
  StyleSheet.create({
    summary: {
      flexDirection: 'row',
      gap: 8,
    },
    stat: {
      backgroundColor: colors.card,
      borderRadius: 20,
      flex: 1,
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    statValue: {
      fontSize: 18,
    },
    chart: {
      paddingVertical: 12,
    },
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    number: {
      color: colors.ink40,
      width: NUMBER_WIDTH,
    },
    took: {
      color: colors.ink,
      textAlign: 'right',
      width: TOOK_WIDTH,
    },
    legend: {
      columnGap: 16,
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 4,
      rowGap: 2,
    },
    note: {
      paddingVertical: 12,
      textAlign: 'center',
    },
  }),
);
