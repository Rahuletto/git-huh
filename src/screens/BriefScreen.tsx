import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Markdown } from '../components/Markdown';
import { PullHeader } from '../components/PullHeader';
import { Label } from '../components/Type';
import type { Activity } from '../lib/activity';
import { pullRoute, useNav } from '../lib/nav';
import { space } from '../theme';
import { Block, More, ScreenHead } from './shared';

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
            onPress={() => nav.open(pullRoute(pr))}
          >
            <PullHeader commentCount={pr.comments} pull={pr} />
            <View style={styles.excerpt}>
              <Markdown limit={260} source={pr.body} width={width - space.gutter * 2 - 8} />
            </View>
          </Pressable>
          {pulls.length > 1 && (
            <More label={`read all ${pulls.length} in order`} onPress={() => nav.open(pullRoute(pr, pulls))} />
          )}
        </>
      )}
    </Block>
  );
}

const styles = StyleSheet.create({
  excerpt: { paddingHorizontal: 4, paddingTop: 10 },
  note: { paddingVertical: 12, textAlign: 'center' },
});
