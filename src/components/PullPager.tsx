import { StyleSheet, View } from 'react-native';

import { pullRoute, useNav } from '../lib/nav';
import type { PullRef } from '../lib/pullRequest';
import { space } from '../theme';
import { IconPill } from './Icon';
import { Data } from './Type';

/** Sequence navigation replaces the current PR; back still returns to its source. */
export function PullPager({ pull, sequence }: { pull: PullRef; sequence: readonly PullRef[] }) {
  const nav = useNav();
  const at = sequence.findIndex((item) => item.repo.toLowerCase() === pull.repo.toLowerCase() && item.number === pull.number);
  if (at < 0 || sequence.length < 2) return null;
  return (
    <View style={styles.pager}>
      <IconPill
        label="← prev"
        disabled={at === 0}
        onPress={() => { if (at > 0) nav.replace(pullRoute(sequence[at - 1], sequence)); }}
      />
      <Data>{at + 1} of {sequence.length}</Data>
      <IconPill
        label="next →"
        disabled={at === sequence.length - 1}
        onPress={() => { if (at + 1 < sequence.length) nav.replace(pullRoute(sequence[at + 1], sequence)); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pager: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.gutter, paddingVertical: 8 },
});
