import { StyleSheet, View } from 'react-native';

import { SocialFeed } from '../components/SocialFeed';
import { Micro } from '../components/Type';
import { savedAge } from '../lib/store';
import { useSession } from '../shell/session';
import { colors, themed } from '../theme';
import { AssignedTile } from './AssignedScreen';
import { QueueTile } from './QueueScreen';
import { Block, Page, ScreenHead } from './shared';

/**
 * The `inbox` section: everything on GitHub that is addressed to you, on one
 * page.
 *
 * At the top, the two lists that are about *you* rather than about your
 * work — the pull requests waiting on your review and what is assigned to
 * you — folded into a card each, with a dot for every item sized by how
 * long it has waited, so the one that has sat a month is visible before
 * anything is opened. Each card opens its list in full. Under them, the
 * feed: every row opens in the app — a pull request, an issue, a
 * discussion — and every row can be put away: `done`, or `snoozed` until
 * the morning, both of which undo themselves the moment someone writes on
 * the thread again.
 *
 * Read state is the app's own and lives on the phone; no `notifications`
 * scope is asked for, so GitHub's inbox is never touched.
 */
export function InboxScreen() {
  const { openEvent, queue, social, tasks, triage } = useSession();
  const count = social.status === 'ready' ? social.events.length : null;

  return (
    <Page blocks>
      <Block>
        <ScreenHead left="what wants you" />
        <View style={styles.tiles}>
          <QueueTile state={queue} />
          <AssignedTile state={tasks} />
        </View>
      </Block>

      <Block>
        <ScreenHead left="recent" right={count == null ? '' : `${count} events`} />
        {social.status === 'ready' && social.offline && social.savedAt != null && (
          <Micro style={styles.dim}>offline · saved {savedAge(social.savedAt)}</Micro>
        )}
        <SocialFeed onOpen={openEvent} state={social} triage={triage} />
      </Block>
    </Page>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    tiles: {
      flexDirection: 'row',
      gap: 10,
    },
    dim: {
      color: colors.ink40,
    },
  }),
);
