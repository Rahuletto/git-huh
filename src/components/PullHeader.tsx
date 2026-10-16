import { Pressable, StyleSheet, View } from 'react-native';

import { useNav } from '../lib/nav';
import type { PullSummary } from '../lib/pullRequest';
import { ago, fmt } from '../screens/shared';
import { colors, radii, themed } from '../theme';
import { DiffDots } from './DiffDots';
import { StateChip } from './StateChip';
import { Data, Heading } from './Type';

/** pin03's card: number and state, repository, title, the diff, the figures, the labels. */
export function PullHeader({ pull: pr, author, commentCount }: { pull: PullSummary; author?: string; commentCount?: number }) {
  const nav = useNav();
  return (
    <View style={styles.card}>
      <View style={styles.tabRow}>
        <Data style={styles.tabText}>#{pr.number}</Data>
        <PullStatus pull={pr} />
      </View>

      <Data style={styles.repo}>{pr.repo}</Data>
      <Heading style={styles.prTitle}>{pr.title}</Heading>

      <View style={styles.diff}>
        <DiffDots additions={pr.additions} deletions={pr.deletions} />
      </View>

      <View style={styles.statRow}>
        <Data style={styles.stat}>{fmt(pr.changedFiles)} files</Data>
        <Data style={styles.stat}>{fmt(pr.commits)} commits</Data>
        {commentCount != null && <Data style={styles.stat}>{fmt(commentCount)} comments</Data>}
        {author && (
          <Pressable accessibilityRole="link" onPress={() => nav.open({ kind: 'user', login: author })}>
            <Data style={styles.stat}>~{author}</Data>
          </Pressable>
        )}
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

export function PullStatus({ pull: pr }: { pull: Pick<PullSummary, 'isDraft' | 'state' | 'reviewDecision'> }) {
  const [text, tone] = pr.isDraft
    ? ['draft', colors.ink40]
    : pr.state === 'MERGED'
      ? ['merged', colors.ink]
      : pr.state === 'CLOSED'
        ? ['closed', colors.no]
        : pr.reviewDecision === 'APPROVED'
          ? ['approved', colors.yes]
          : pr.reviewDecision === 'CHANGES_REQUESTED'
            ? ['changes', colors.no]
            : ['open', colors.ink];
  return <StateChip text={text} tone={tone} />;
}

const styles = themed(() => StyleSheet.create({
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
}));
