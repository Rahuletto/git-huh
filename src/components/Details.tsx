import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { listAssignable, listLabels, listMilestones } from '../lib/explore';
import { useNav } from '../lib/nav';
import {
  editIssue,
  requestReviewers,
  setAssignees,
  setLabels,
  setLocked,
  setMilestone,
  setPinned,
} from '../lib/writes';
import { colors, fonts, radii, themed } from '../theme';
import { Composer, type ComposerAction } from './Composer';
import { IconButton, IconPill } from './Icon';
import { Picker } from './Picker';
import { Data, Label, Micro } from './Type';

type Editing = 'labels' | 'assignees' | 'reviewers' | 'milestone' | 'text' | null;

const DEMO_PEOPLE = ['octocat', 'annapetrova', 'theo', 'marcusleroy'].map((login) => ({
  key: login,
  label: login,
}));
const DEMO_LABELS = ['bug', 'enhancement', 'documentation', 'good first issue', 'widget'].map(
  (name) => ({ key: name, label: name }),
);

/**
 * The side column of an issue or a pull request on the website, as rows:
 * labels, who it is assigned to, who is asked to review it, the milestone —
 * each with `change`, which opens a picker in place — and under them the
 * title and the description to edit, and the verbs that change how the
 * thread itself behaves: lock it, pin it.
 */
export function Details({
  kind,
  repo,
  number,
  nodeId,
  title,
  body,
  labels = [],
  assignees = [],
  reviewers,
  milestone,
  locked,
  pinned,
  canUpdate,
  onChanged,
  textOpen,
  onTextClose,
}: {
  kind: 'issue' | 'pull';
  repo: string;
  number: number;
  nodeId: string;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  /** Pull requests only. */
  reviewers?: string[];
  milestone: { number: number; title: string } | null;
  locked: boolean;
  /** Issues only. */
  pinned?: boolean;
  canUpdate: boolean;
  onChanged: () => void;
  /**
   * The title editor opened from somewhere else — the pencil on the page's
   * title card. When given, this column draws no edit button of its own.
   */
  textOpen?: boolean;
  onTextClose?: () => void;
}) {
  const nav = useNav();
  const token = nav.token ?? '';
  const [picking, setEditing] = useState<Editing>(null);
  // Null until typed in, so an editor opened again starts from the saved title.
  const [typedTitle, setDraftTitle] = useState<string | null>(null);
  const draftTitle = typedTitle ?? title;
  const controlled = textOpen !== undefined;
  // Opened from the title card, the editor wins over any open picker.
  const editing: Editing = controlled ? (textOpen ? 'text' : picking) : picking;
  const closeText = () => {
    setEditing(null);
    setDraftTitle(null);
    onTextClose?.();
  };

  const done = (note: string) => {
    closeText();
    onChanged();
    return note;
  };

  const row = (name: Exclude<Editing, null | 'text'>, value: string) => (
    <View style={styles.row}>
      <Label style={styles.name}>{name}</Label>
      <Data numberOfLines={2} style={styles.value}>
        {value || '—'}
      </Data>
      {canUpdate && (
        <IconButton
          icon={editing === name ? 'close' : 'edit'}
          label={editing === name ? `close the ${name}` : `change the ${name}`}
          on={editing === name}
          onPress={() => {
            if (controlled && textOpen) onTextClose?.();
            setEditing(editing === name ? null : name);
          }}
          size={28}
        />
      )}
    </View>
  );

  const verbs: (ComposerAction & { run: () => Promise<string> })[] = [
    ...(nav.login && !assignees.includes(nav.login)
      ? [
          {
            key: 'me',
            label: 'assign me',
            icon: 'assignMe' as const,
            run: async () => {
              await setAssignees(token, repo, number, assignees, [...assignees, nav.login ?? '']);
              return 'assigned to you';
            },
          },
        ]
      : []),
    ...(canUpdate
      ? [
          {
            key: 'lock',
            label: locked ? 'unlock' : 'lock',
            icon: locked ? ('unlock' as const) : ('lock' as const),
            confirm: locked ? undefined : 'lock it?',
            run: async () => {
              await setLocked(token, repo, number, !locked);
              return locked ? 'unlocked' : 'locked · only collaborators can comment';
            },
          },
        ]
      : []),
    ...(kind === 'issue' && canUpdate && pinned !== undefined
      ? [
          {
            key: 'pin',
            label: pinned ? 'unpin' : 'pin',
            icon: 'pin' as const,
            on: pinned,
            run: async () => {
              await setPinned(token, nodeId, !pinned);
              return pinned ? 'unpinned' : 'pinned';
            },
          },
        ]
      : []),
  ];

  return (
    <View style={styles.box}>
      {row('labels', labels.join(', '))}
      {editing === 'labels' && (
        <Picker
          current={labels}
          demo={DEMO_LABELS}
          load={async (signal) =>
            (await listLabels(token, repo, signal)).map((label) => ({ key: label.name, label: label.name }))
          }
          loadKey={`labels|${repo}`}
          onClose={() => setEditing(null)}
          onSave={async (chosen) => {
            await setLabels(token, repo, number, chosen);
            return done('labels saved');
          }}
          what="labels"
        />
      )}

      {row('assignees', assignees.map((login) => `~${login}`).join(', '))}
      {editing === 'assignees' && (
        <Picker
          current={assignees}
          demo={DEMO_PEOPLE}
          load={async (signal) =>
            (await listAssignable(token, repo, signal)).map((login) => ({ key: login, label: login }))
          }
          loadKey={`assignable|${repo}`}
          onClose={() => setEditing(null)}
          onSave={async (chosen) => {
            await setAssignees(token, repo, number, assignees, chosen);
            return done('assignees saved');
          }}
          what="assignees"
        />
      )}

      {reviewers && row('reviewers', reviewers.map((login) => `~${login}`).join(', '))}
      {reviewers && editing === 'reviewers' && (
        <Picker
          current={reviewers}
          demo={DEMO_PEOPLE}
          load={async (signal) =>
            (await listAssignable(token, repo, signal))
              .filter((login) => login !== nav.login)
              .map((login) => ({ key: login, label: login }))
          }
          loadKey={`assignable|${repo}`}
          onClose={() => setEditing(null)}
          onSave={async (chosen) => {
            await requestReviewers(token, repo, number, reviewers, chosen);
            return done('reviewers asked');
          }}
          what="reviewers"
        />
      )}

      {row('milestone', milestone?.title ?? '')}
      {editing === 'milestone' && (
        <Picker
          allowNone
          current={milestone ? [String(milestone.number)] : []}
          demo={[{ key: '1', label: 'v0.1' }]}
          load={async (signal) =>
            (await listMilestones(token, repo, signal)).map((item) => ({
              key: String(item.number),
              label: item.title,
            }))
          }
          loadKey={`milestones|${repo}`}
          multi={false}
          onClose={() => setEditing(null)}
          onSave={async (chosen) => {
            await setMilestone(token, repo, number, chosen[0] ? Number(chosen[0]) : null);
            return done(chosen[0] ? 'milestone set' : 'milestone cleared');
          }}
          what="milestone"
        />
      )}

      {canUpdate && !controlled && editing !== 'text' && (
        <IconPill
          icon="edit"
          label="edit title and description"
          onPress={() => {
            setDraftTitle(null);
            setEditing('text');
          }}
          style={styles.editLink}
        />
      )}
      {editing === 'text' && (
        <View>
          <Micro style={styles.fieldLabel}>title</Micro>
          <TextInput
            onChangeText={setDraftTitle}
            placeholderTextColor={colors.ink40}
            style={styles.title}
            value={draftTitle}
          />
          <Composer
            actions={[{ key: 'save', label: 'save', primary: true, allowEmpty: true, icon: 'save' }]}
            compact
            demo={nav.demo}
            doing="that edit"
            initial={body}
            onCancel={closeText}
            onSubmit={async (_, text) => {
              if (!draftTitle.trim()) throw new Error('a title is needed');
              await editIssue(token, repo, number, { title: draftTitle.trim(), body: text });
              return done('saved');
            }}
            placeholder="the description"
          />
        </View>
      )}

      {verbs.length > 0 && (
        <Composer
          actions={verbs}
          bare
          demo={nav.demo}
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
      borderTopColor: colors.hair,
      borderTopWidth: 1,
      marginTop: 22,
      paddingTop: 6,
    },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.hair,
      borderBottomWidth: 1,
      flexDirection: 'row',
      gap: 10,
      paddingVertical: 9,
    },
    name: {
      color: colors.ink40,
      width: 82,
    },
    value: {
      color: colors.ink,
      flex: 1,
      fontSize: 12,
    },
    editLink: {
      marginTop: 12,
    },
    fieldLabel: {
      color: colors.ink40,
      marginBottom: 4,
      marginTop: 10,
    },
    title: {
      backgroundColor: colors.card,
      borderColor: colors.hair,
      borderRadius: radii.tile,
      borderWidth: 1,
      color: colors.ink,
      fontFamily: fonts.mono,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
  }),
);
