import type { PullDetailFull } from './pullDetail';

/** What GitHub says about merging, in one line, and whether it is good news. */
export function mergeLine(pull: Pick<PullDetailFull, 'state' | 'isDraft' | 'mergeable' | 'mergeState' | 'baseRefName' | 'autoMergeOn'>): {
  text: string;
  tone: 'yes' | 'no' | 'ink';
} {
  if (pull.state === 'MERGED') return { text: 'merged', tone: 'yes' };
  if (pull.state === 'CLOSED') return { text: 'closed without merging', tone: 'ink' };
  if (pull.isDraft) return { text: 'a draft · mark it ready to merge it', tone: 'ink' };
  if (pull.mergeable === 'CONFLICTING' || pull.mergeState === 'DIRTY') {
    return { text: `conflicts with ${pull.baseRefName} · they need resolving first`, tone: 'no' };
  }
  if (pull.autoMergeOn) return { text: 'will merge on its own when it is ready', tone: 'ink' };
  switch (pull.mergeState) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { text: 'ready to merge', tone: 'yes' };
    case 'BEHIND':
      return { text: `behind ${pull.baseRefName} · update the branch first`, tone: 'ink' };
    case 'BLOCKED':
      return { text: 'blocked · a required review or check is missing', tone: 'no' };
    case 'UNSTABLE':
      return { text: 'checks are failing · it can still be merged', tone: 'no' };
    default:
      return { text: 'github is still working out whether it merges', tone: 'ink' };
  }
}
