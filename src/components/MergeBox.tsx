import { StyleSheet, View } from 'react-native';

import { useNav } from '../lib/nav';
import { mergeLine } from '../lib/pullState';
import type { PullDetailFull } from '../lib/pullDetail';
import {
  deleteBranch,
  mergePull,
  setAutoMerge,
  setDraft,
  setPullOpen,
  updatePullBranch,
  type MergeMethod,
} from '../lib/writes';
import { colors, radii, themed } from '../theme';
import { Composer, type ComposerAction } from './Composer';
import { Label, Micro } from './Type';

const WRITERS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);

const METHOD_LABEL: Record<MergeMethod, string> = {
  MERGE: 'merge',
  SQUASH: 'squash and merge',
  REBASE: 'rebase and merge',
};

/**
 * The bottom of a pull request on the website: whether it can merge, the
 * merge buttons this repository allows, and the verbs around them — update
 * the branch, merge when ready, back to draft, close, and once it is in,
 * delete the branch. Merging and closing are pressed twice.
 */
export function MergeBox({ pull, onChanged }: { pull: PullDetailFull; onChanged: () => void }) {
  const nav = useNav();
  const token = nav.token ?? '';
  const canWrite = WRITERS.has(pull.permission ?? '');
  const mayManage = canWrite || pull.viewerIsAuthor;
  const line = mergeLine(pull);
  const open = pull.state === 'OPEN';
  const blocked = pull.isDraft || pull.mergeable === 'CONFLICTING';
  const methods = pull.mergeMethods ?? [];

  const verbs: (ComposerAction & { run: () => Promise<string> })[] = [];
  if (open && canWrite) {
    for (const method of methods) {
      verbs.push({
        key: `merge-${method}`,
        label: METHOD_LABEL[method],
        confirm: `${METHOD_LABEL[method]}? press again`,
        primary: method === methods[0] && line.tone === 'yes',
        disabled: blocked,
        run: async () => {
          await mergePull(token, pull.id, method, pull.headSha);
          return 'merged';
        },
      });
    }
    if (pull.autoMergeAllowed && line.tone !== 'yes' && !blocked && methods[0]) {
      verbs.push({
        key: 'auto',
        label: pull.autoMergeOn ? 'cancel auto-merge' : 'merge when ready',
        run: async () => {
          await setAutoMerge(token, pull.id, pull.autoMergeOn ? null : (methods[0] ?? 'MERGE'));
          return pull.autoMergeOn ? 'auto-merge off' : 'it will merge when it is ready';
        },
      });
    }
  }
  if (open && pull.canUpdateBranch && pull.mergeState === 'BEHIND') {
    verbs.push({
      key: 'update',
      label: 'update branch',
      run: async () => {
        await updatePullBranch(token, pull.id);
        return `${pull.baseRefName} merged into ${pull.headRefName}`;
      },
    });
  }
  if (open && mayManage) {
    verbs.push({
      key: 'draft',
      label: pull.isDraft ? 'ready for review' : 'back to draft',
      run: async () => {
        await setDraft(token, pull.id, !pull.isDraft);
        return pull.isDraft ? 'ready for review' : 'a draft again';
      },
    });
  }
  if (pull.state !== 'MERGED' && mayManage) {
    verbs.push({
      key: 'state',
      label: open ? 'close pull request' : 'reopen',
      confirm: open ? 'close it?' : undefined,
      run: async () => {
        await setPullOpen(token, pull.id, !open);
        return open ? 'closed' : 'reopened';
      },
    });
  }
  if (!open && pull.headRefExists && pull.headRepo && (canWrite || pull.viewerIsAuthor)) {
    const headRepo = pull.headRepo;
    verbs.push({
      key: 'branch',
      label: `delete ${pull.headRefName}`,
      confirm: `delete ${pull.headRefName}?`,
      run: async () => {
        await deleteBranch(token, headRepo, pull.headRefName);
        return 'branch deleted';
      },
    });
  }

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Label style={styles.title}>merge</Label>
        <Micro style={[styles.line, line.tone === 'yes' && styles.yes, line.tone === 'no' && styles.no]}>
          {line.tone === 'yes' ? '✓ ' : line.tone === 'no' ? '× ' : ''}
          {line.text}
        </Micro>
      </View>
      {open && !canWrite && (
        <Micro style={styles.hint}>only people who can push to {pull.repo} can merge it</Micro>
      )}
      {verbs.length > 0 && (
        <Composer
          actions={verbs}
          bare
          demo={nav.demo}
          doing="that"
          onSubmit={async (key) => {
            const verb = verbs.find((item) => item.key === key);
            const note = verb ? await verb.run() : '';
            onChanged();
            return note;
          }}
        />
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    box: {
      backgroundColor: colors.card,
      borderRadius: radii.card,
      marginTop: 22,
      padding: 14,
    },
    head: {
      gap: 4,
    },
    title: {
      color: colors.ink,
    },
    line: {
      color: colors.ink70,
    },
    yes: {
      color: colors.yes,
    },
    no: {
      color: colors.no,
    },
    hint: {
      color: colors.ink40,
      marginTop: 8,
    },
  }),
);
