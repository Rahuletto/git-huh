import { Pressable, StyleSheet, View } from 'react-native';

import { colors, space, themed } from '../theme';
import { Squiggle } from './Squiggle';
import { Label } from './Type';

/**
 * The views of one pushed page about one thing — a pull request's brief,
 * talk, diff and checks.
 *
 * Only a pushed page has these. A section never does: the bar at the bottom
 * is the one row of tabs under a section, and a second row inside it was a
 * tab bar in a tab bar (LANGUAGE §7). A pushed page covers the bar, so here
 * this row is the only one on screen.
 *
 * Selected is the widget's own mark: the word in full ink with the app's
 * wave under it, the others in grey — the same two weights as the widget's
 * `repo ~~~ message` strip. The row wraps rather than scrolls.
 */
export function Segments({
  items,
  current,
  onSelect,
}: {
  items: readonly string[];
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.row}>
      {items.map((label, index) => {
        const on = index === current;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={6}
            key={label}
            onPress={() => onSelect(index)}
            style={styles.item}
          >
            <Label style={on ? styles.labelOn : styles.label}>{label}</Label>
            <Squiggle
              amplitude={1.8}
              color={colors.ink}
              // Plex Mono is 0.6 em a glyph at 11pt, plus the tracking.
              length={Math.max(14, label.length * 7)}
              opacity={on ? 0.7 : 0}
              strokeWidth={1.2}
              wavelength={9}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 20,
      paddingBottom: 8,
      paddingHorizontal: space.gutter,
      paddingTop: 2,
    },
    item: {
      gap: 1,
    },
    label: {
      color: colors.ink40,
    },
    labelOn: {
      color: colors.ink,
    },
  }),
);
