import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { DiffDots } from '../components/DiffDots';
import { Markdown } from '../components/Markdown';
import { OverlayFrame } from '../components/Overlay';
import { StateChip } from '../components/StateChip';
import { Squiggle } from '../components/Squiggle';
import { Data, Heading, Label } from '../components/Type';
import type { Activity, PullDetail } from '../lib/activity';
import { useNav } from '../lib/nav';
import { useSession } from '../shell/session';
import { colors, radii, space, themed } from '../theme';
import { ago, Block, fmt, More, ScreenHead } from './shared';

/**
 * The brief on the `work` page: the newest of your pull requests as pin03's
 * filing card — its state, its title, the size of its diff, the first lines
 * of its description — and the way into the reader that pages through the
 * rest. The card itself opens that pull request.
 */
export function BriefTile({ activity, loading }: { activity: Activity; loading: boolean }) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const pulls = activity.pulls;
  const pr = pulls[0];

  return (
    <Block>
      <ScreenHead
        left="the brief"
        right={pulls.length > 0 ? `${pulls.length} descriptions` : ''}
      />
      {loading && !pr && <Label style={styles.note}>opening the file…</Label>}
      {!loading && !pr && <Label style={styles.note}>no pull requests to read</Label>}
      {pr && (
        <>
          <Pressable
            accessibilityHint="opens the pull request"
            accessibilityRole="button"
            onPress={() => nav.open({ kind: 'pull', repo: pr.repo, number: pr.number })}
          >
            <FileCard pr={pr} />
            <View style={styles.excerpt}>
              <Markdown limit={260} source={pr.body} width={width - space.gutter * 2 - 8} />
            </View>
          </Pressable>
          {pulls.length > 1 && (
            <More label={`read all ${pulls.length} in order`} onPress={() => nav.open({ kind: 'brief' })} />
          )}
        </>
      )}
    </Block>
  );
}

/** pin03's card: number and state, repository, title, the diff, the figures, the labels. */
function FileCard({ pr }: { pr: PullDetail }) {
  return (
    <View style={styles.card}>
      <View style={styles.tabRow}>
        <Data style={styles.tabText}>#{pr.number}</Data>
        <PullState pr={pr} />
      </View>

      <Data style={styles.repo}>{pr.repo}</Data>
      <Heading style={styles.prTitle}>{pr.title}</Heading>

      <View style={styles.diff}>
        <DiffDots additions={pr.additions} deletions={pr.deletions} />
      </View>

      <View style={styles.statRow}>
        <Data style={styles.stat}>{fmt(pr.changedFiles)} files</Data>
        <Data style={styles.stat}>{fmt(pr.commits)} commits</Data>
        <Data style={styles.stat}>{fmt(pr.comments)} comments</Data>
        <Data style={styles.stat}>{ago(pr.createdAt)}</Data>
      </View>

      {pr.labels.length > 0 && (
        <View style={styles.labels}>
          {pr.labels.map((label) => (
            <View key={label.name} style={styles.label}>
              <Data style={styles.labelText}>{label.name}</Data>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * pin03's filing card, opened up: your pull requests' descriptions, one
 * after another, without going back to a list each time.
 *
 * The description is rendered rather than printed: GitHub hands back raw
 * Markdown, and verbatim a heading arrives as a literal `## Problem` and a
 * list as a column of hyphens.
 *
 * Paging lives in a bar pinned to the bottom, so `next` is in the same place
 * on every pull request. Under the description, its position would depend on
 * how much the author had written. Where you are is said once, in that bar.
 */
export function BriefPage() {
  const nav = useNav();
  const { activity, activityState } = useSession();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const pulls = activity.pulls;
  const at = Math.min(index, Math.max(0, pulls.length - 1));
  const pr = pulls[at];
  const body = width - space.gutter * 2;
  const go = (next: number) => {
    setIndex(next);
    scroll.current?.scrollTo({ animated: false, y: 0 });
  };

  return (
    <OverlayFrame
      footer={
        pr ? (
          <View style={styles.footer}>
            <Squiggle
              amplitude={2.4}
              length={width}
              opacity={0.35}
              style={styles.footerRule}
              wavelength={15}
            />
            <Pressable
              accessibilityRole="button"
              disabled={at <= 0}
              onPress={() => go(Math.max(0, at - 1))}
              style={[styles.pill, at <= 0 && styles.muted]}
            >
              <Label style={styles.pillLabel}>← prev</Label>
            </Pressable>
            <Data style={styles.counter}>
              {at + 1} of {pulls.length}
            </Data>
            <Pressable
              accessibilityRole="button"
              disabled={at >= pulls.length - 1}
              onPress={() => go(Math.min(pulls.length - 1, at + 1))}
              style={[styles.pill, styles.solid, at >= pulls.length - 1 && styles.muted]}
            >
              <Label style={styles.solidLabel}>next →</Label>
            </Pressable>
          </View>
        ) : null
      }
      onBack={nav.close}
      where="work · the brief"
    >
      {activityState.status !== 'ready' && !pr && (
        <Label style={styles.note}>opening the file…</Label>
      )}
      {activityState.status === 'ready' && !pr && (
        <Label style={styles.note}>no pull requests to read</Label>
      )}

      {pr && (
        <ScrollView
          contentContainerStyle={styles.page}
          ref={scroll}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          <FileCard pr={pr} />

          <Label style={styles.bodyHead}>the description</Label>
          <Squiggle
            amplitude={2.4}
            length={body * 0.45}
            opacity={0.45}
            style={styles.headRule}
            wavelength={13}
          />

          {/* Clamped: this is the shelf copy, and the whole thing is one
              tap away on the pull request itself. */}
          <Markdown limit={900} source={pr.body} width={body} />

          <Pressable
            accessibilityRole="button"
            onPress={() => nav.open({ kind: 'pull', repo: pr.repo, number: pr.number })}
            style={styles.openRow}
          >
            <Label style={styles.openLabel}>read the whole thing · talk · diff →</Label>
          </Pressable>
        </ScrollView>
      )}
    </OverlayFrame>
  );
}

function PullState({ pr }: { pr: PullDetail }) {
  const [text, tone] = pr.isDraft
    ? ['draft', colors.ink40]
    : pr.state === 'MERGED'
      ? ['merged', colors.ink]
      : pr.state === 'CLOSED'
        ? ['closed', colors.no]
        : pr.reviewDecision === 'APPROVED'
          ? ['approved', colors.yes]
          : ['open', colors.ink];
  return <StateChip text={text} tone={tone} />;
}

const styles = themed(() =>
  StyleSheet.create({
    excerpt: {
      paddingHorizontal: 4,
      paddingTop: 10,
    },
    scroll: {
      flex: 1,
    },
    page: {
      paddingBottom: 24,
      paddingHorizontal: space.gutter,
      paddingTop: 10,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: radii.card,
      padding: 18,
    },
    tabRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    tabText: {
      color: colors.ink40,
    },
    repo: {
      color: colors.ink40,
      fontSize: 11,
      marginTop: 14,
    },
    prTitle: {
      fontSize: 16,
      lineHeight: 23,
      marginTop: 4,
    },
    diff: {
      marginTop: 16,
    },
    statRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 12,
    },
    stat: {
      color: colors.ink70,
      fontSize: 10,
    },
    labels: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 12,
    },
    label: {
      borderColor: colors.hairStrong,
      borderRadius: radii.pill,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    labelText: {
      fontSize: 10,
    },
    bodyHead: {
      color: colors.ink,
      marginTop: 22,
    },
    headRule: {
      marginBottom: 2,
      marginTop: 2,
    },
    openRow: {
      borderColor: colors.hair,
      borderRadius: radii.pill,
      borderWidth: 1,
      marginTop: 22,
      paddingHorizontal: 16,
      paddingVertical: 11,
    },
    openLabel: {
      color: colors.ink,
      textAlign: 'center',
    },
    footer: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      justifyContent: 'space-between',
      paddingBottom: 6,
      paddingHorizontal: space.gutter,
      paddingTop: 12,
    },
    footerRule: {
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    counter: {
      color: colors.ink40,
      fontSize: 10,
    },
    pill: {
      alignItems: 'center',
      borderColor: colors.hair,
      borderRadius: radii.pill,
      borderWidth: 1,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    pillLabel: {
      color: colors.ink,
    },
    solid: {
      backgroundColor: colors.black,
      borderColor: colors.black,
    },
    solidLabel: {
      color: colors.onBlack,
    },
    muted: {
      opacity: 0.3,
    },
    note: {
      paddingVertical: 12,
      textAlign: 'center',
    },
  }),
);
