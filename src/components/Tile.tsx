import { Pressable, StyleSheet, View } from 'react-native';

import { colors, themed } from '../theme';
import { Card } from './Card';
import { Label, Micro, Title } from './Type';
import { WaitDot } from './WaitDot';

/** Dots past this many say nothing a count does not. */
const MAX_DOTS = 14;

/**
 * A list folded into one of the widget's cards: what it is, how many, a
 * `WaitDot` for each thing in it (so the one that has waited a month is
 * visible from here), and a line of what matters. The whole card opens the
 * list. Two of these side by side are how a section's page carries a list
 * it has no room for — the inbox's review queue and its assignments.
 */
export function Tile({
  title,
  figure,
  unit,
  waits,
  foot,
  hint,
  onPress,
}: {
  title: string;
  /** The count, or null while it is being read. */
  figure: number | null;
  unit: string;
  /** When each thing in the list started waiting, longest first. */
  waits: readonly string[];
  foot: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={`${title}: ${figure ?? 'reading'} ${unit}. ${foot}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.press}
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <Label numberOfLines={1} style={styles.title}>
            {title}
          </Label>
          <Label style={styles.arrow}>→</Label>
        </View>
        <View style={styles.figureRow}>
          <Title>{figure == null ? '…' : figure}</Title>
          <Label numberOfLines={1} style={styles.unit}>
            {unit}
          </Label>
        </View>
        <View style={styles.dots}>
          {waits.slice(0, MAX_DOTS).map((since, index) => (
            <View key={`${since}-${index}`} style={styles.dotCell}>
              <WaitDot since={since} />
            </View>
          ))}
        </View>
        <Micro numberOfLines={2} style={styles.foot}>
          {foot}
        </Micro>
      </Card>
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    press: {
      flex: 1,
    },
    card: {
      flex: 1,
      gap: 6,
    },
    head: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    title: {
      color: colors.ink,
      flex: 1,
    },
    arrow: {
      color: colors.ink40,
    },
    figureRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      gap: 6,
      marginTop: 4,
    },
    unit: {
      color: colors.ink70,
      flexShrink: 1,
    },
    dots: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 2,
      minHeight: 14,
    },
    dotCell: {
      alignItems: 'center',
      height: 14,
      justifyContent: 'center',
      width: 14,
    },
    foot: {
      color: colors.ink40,
      lineHeight: 14,
    },
  }),
);
