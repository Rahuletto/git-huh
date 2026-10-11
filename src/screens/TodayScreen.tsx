import { memo, useCallback } from 'react';

import { useFeedHistory } from '../hooks/useFeedHistory';
import { useSession } from '../shell/session';
import { ClockScreen } from './ClockScreen';
import { HeyScreen, HomeFeed } from './HeyScreen';
import { NowScreen } from './NowScreen';
import { Page } from './shared';

/**
 * Every block redraws when its own data does, not whenever any of the
 * session's does: the inbox refreshes and pages are pushed while this one
 * sits mounted under them.
 */
const Hey = memo(HeyScreen);
const Now = memo(NowScreen);
const Clock = memo(ClockScreen);
const Feed = memo(HomeFeed);

/**
 * `today` — how am I doing — as one page, read top to bottom:
 *
 * 1. `you`: the greeting and the widget's card, and the year in a sentence.
 * 2. `today`: the count in the widget's dots, the weather, the last seven
 *    and thirty days, the languages.
 * 3. `hours`: when you commit, from real timestamps.
 * 4. what people said on your pull requests — last, because it pages in
 *    older history as you scroll and so has no end.
 *
 * `hours` is the one block that needs the commit history, a second and
 * heavier request; it is asked for once the page is scrolled towards it,
 * never on launch.
 */
export function TodayScreen({ active }: { active: boolean }) {
  const session = useSession();
  const { activity, activityState, home, lines, model, nav, openEvent, social, wantActivity } =
    session;
  const history = useFeedHistory(nav.token, nav.login, active && home.blocks.length > 0);

  const openAccount = useCallback(() => nav.open({ kind: 'account' }), [nav]);
  const shareYear = useCallback(() => nav.open({ kind: 'share', card: 'year' }), [nav]);
  const shareHours = useCallback(() => nav.open({ kind: 'share', card: 'hours' }), [nav]);

  if (!model) return null;

  return (
    <Page blocks onDeep={wantActivity} onEnd={history.more}>
      <Hey active={active} lines={lines} model={model} onShare={shareYear} />
      <Now model={model} />
      <Clock
        activity={activity}
        loading={activityState.status !== 'ready'}
        onShare={shareHours}
      />
      <Feed
        history={history}
        home={home}
        onOpen={openEvent}
        onSettings={openAccount}
        social={social}
      />
    </Page>
  );
}
