import { memo, useCallback } from 'react';

import { useSession } from '../shell/session';
import { BriefTile } from './BriefScreen';
import { CardsScreen } from './CardsScreen';
import { IndexScreen } from './IndexScreen';
import { ReviewScreen } from './ReviewScreen';
import { Page } from './shared';

const Pulls = memo(IndexScreen);
const Brief = memo(BriefTile);
const Cycle = memo(ReviewScreen);
const Repos = memo(CardsScreen);

/**
 * `work` — what am I shipping — as one page:
 *
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
      nav.open({ kind: 'pull', repo: pr.repo, number: pr.number }),
    [nav],
  );

  if (!model) return null;

  return (
    <Page blocks>
      <Pulls onOpen={openPull} state={prs} />
      <Brief activity={activity} loading={loading} />
      <Cycle activity={activity} loading={loading} />
      <Repos activity={activity} model={model} />
    </Page>
  );
}
