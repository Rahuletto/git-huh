import { pullRoute } from '../lib/nav';
import { memo, useCallback } from 'react';

import { useSession } from '../shell/session';
import { BriefTile } from './BriefScreen';
import { InboxBlocks } from './InboxScreen';
import { CardsScreen } from './CardsScreen';
import { IndexScreen } from './IndexScreen';
import { ReviewScreen } from './ReviewScreen';
import { Page } from './shared';

const Pulls = memo(IndexScreen);
const Brief = memo(BriefTile);
const Cycle = memo(ReviewScreen);
const Repos = memo(CardsScreen);

/**
 * `work` — what wants me, and what am I shipping — as one page:
 *
 * 0. what wants you and the inbox: the review queue, what is assigned to
 *    you, and the head of the feed (`InboxBlocks`). This was its own
 *    section; it is the start of the working day, so it opens `work`.
 * 1. `pulls`: your open pull requests, filed by repository.
 * 2. `the brief`: the newest description, and the reader that pages
 *    through the rest one after another.
 * 3. `cycle`: how long they actually take, row by row.
 * 4. `repos`: the deck, newest work on top, and a search through all of
 *    their code.
 */
export function WorkScreen() {
  const { activity, activityState, model, nav, prs } = useSession();
  const loading = activityState.status !== 'ready';
  const openPull = useCallback(
    (pr: { repo: string; number: number }) =>
      nav.open(pullRoute(pr)),
    [nav],
  );

  if (!model) return null;

  return (
    <Page blocks>
      <InboxBlocks />
      <Pulls onOpen={openPull} state={prs} />
      <Brief activity={activity} loading={loading} />
      <Cycle activity={activity} loading={loading} />
      <Repos activity={activity} model={model} />
    </Page>
  );
}
