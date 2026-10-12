import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useNav } from '../lib/nav';
import type { Reaction } from '../lib/reactions';
import { deleteComment, editComment, type CommentKind } from '../lib/writes';
import { colors, themed } from '../theme';
import { Composer, type ComposerAction } from './Composer';
import { Reactions } from './Reactions';
import { Label } from './Type';

export interface Verb {
  action: ComposerAction;
  /** Resolves with the line to show. */
  run: () => Promise<string>;
}

/**
 * What can be done to one thing someone said, under it: react, reply to it,
 * edit or delete it if it is yours, and whatever else its kind allows —
 * resolve a thread, mark the answer, vote it up. Replying and editing open a
 * small box in place; nothing here pushes a page.
 */
export function CommentTools({
  subjectId,
  body,
  reactions,
  editKind,
  canEdit = false,
  canDelete = false,
  reply,
  verbs = [],
  onChanged,
}: {
  subjectId: string;
  body: string;
  reactions: Reaction[];
  /** Which mutation edits and deletes it; null when neither can. */
  editKind: CommentKind | null;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Present when a reply can go under this one. */
  reply?: { label: string; send: (text: string) => Promise<void> };
  verbs?: Verb[];
  onChanged: () => void;
}) {
  const nav = useNav();
  const token = nav.token ?? '';
  const [open, setOpen] = useState<'reply' | 'edit' | null>(null);

  const all: Verb[] = [
    ...verbs,
    ...(editKind && canDelete
      ? [
          {
            action: { key: 'delete', label: 'delete', confirm: 'delete it?' },
            run: async () => {
              await deleteComment(token, editKind, subjectId);
              return 'deleted';
            },
          },
        ]
      : []),
  ];

  return (
    <View style={styles.tools}>
      <Reactions onChanged={onChanged} reactions={reactions} subjectId={subjectId} />

      <View style={styles.links}>
        {reply && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open === 'reply' }}
            hitSlop={6}
            onPress={() => setOpen(open === 'reply' ? null : 'reply')}
          >
            <Label style={styles.link}>{reply.label}</Label>
          </Pressable>
        )}
        {editKind && canEdit && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open === 'edit' }}
            hitSlop={6}
            onPress={() => setOpen(open === 'edit' ? null : 'edit')}
          >
            <Label style={styles.link}>edit</Label>
          </Pressable>
        )}
      </View>

      {all.length > 0 && (
        <Composer
          actions={all.map((verb) => verb.action)}
          bare
          demo={nav.demo}
          doing="that"
          onSubmit={async (key) => {
            const verb = all.find((item) => item.action.key === key);
            const note = verb ? await verb.run() : '';
            onChanged();
            return note;
          }}
        />
      )}

      {open === 'reply' && reply && (
        <Composer
          actions={[{ key: 'reply', label: 'reply', primary: true }]}
          compact
          demo={nav.demo}
          doing="that reply"
          onCancel={() => setOpen(null)}
          onSubmit={async (_, text) => {
            await reply.send(text);
            setOpen(null);
            onChanged();
            return 'sent · it is on github now';
          }}
          placeholder="reply to this"
        />
      )}
      {open === 'edit' && editKind && (
        <Composer
          actions={[{ key: 'save', label: 'save the edit', primary: true }]}
          compact
          demo={nav.demo}
          doing="that edit"
          initial={body}
          onCancel={() => setOpen(null)}
          onSubmit={async (_, text) => {
            await editComment(token, editKind, subjectId, text);
            setOpen(null);
            onChanged();
            return 'edited';
          }}
          placeholder="what it should say"
        />
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    tools: {
      marginTop: 8,
    },
    links: {
      flexDirection: 'row',
      gap: 16,
      marginTop: 8,
    },
    link: {
      color: colors.ink70,
      textDecorationLine: 'underline',
    },
  }),
);
