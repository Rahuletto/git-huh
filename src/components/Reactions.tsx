import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useNav } from '../lib/nav';
import {
  REACTIONS,
  reactionWord,
  toggleReaction,
  type Reaction,
  type ReactionContent,
} from '../lib/reactions';
import { setReaction } from '../lib/writes';
import { colors, radii, themed } from '../theme';
import { Composer } from './Composer';
import { Label } from './Type';

/**
 * The reactions under something said, as words with their counts: `+1 3`,
 * `heart 1`, yours filled. `react` opens the other six; pressing one of
 * yours takes it back. The change shows at once and the page reloads behind
 * it, so a slow network never makes a press look ignored.
 */
export function Reactions({
  subjectId,
  reactions,
  onChanged,
}: {
  subjectId: string;
  reactions: Reaction[];
  onChanged?: () => void;
}) {
  const nav = useNav();
  const [picking, setPicking] = useState(false);
  // What the screen shows: GitHub's answer, or the press made since it.
  const [local, setLocal] = useState<{ from: Reaction[]; value: Reaction[] } | null>(null);
  // A saved answer from an older build can lack the list; draw none rather than crash.
  const base = reactions ?? [];
  const shown = local && local.from === reactions ? local.value : base;

  const offered: ReactionContent[] = picking
    ? REACTIONS.map(([content]) => content)
    : shown.map((reaction) => reaction.content);

  return (
    <View style={styles.row}>
      {offered.length > 0 && (
        <View style={styles.grow}>
          <Composer
            actions={offered.map((content) => {
              const reaction = shown.find((item) => item.content === content);
              return {
                key: content,
                label: reaction ? `${reactionWord(content)} ${reaction.count}` : reactionWord(content),
                on: reaction?.mine ?? false,
              };
            })}
            bare
            demo={nav.demo}
            doing="that reaction"
            onSubmit={async (key) => {
              const content = key as ReactionContent;
              const mine = shown.find((item) => item.content === content)?.mine ?? false;
              setLocal({ from: reactions, value: toggleReaction(shown, content) });
              setPicking(false);
              await setReaction(nav.token ?? '', subjectId, content, !mine);
              onChanged?.();
              return mine ? 'taken back' : 'reacted';
            }}
            quiet
          />
        </View>
      )}
      <Pressable
        accessibilityLabel={picking ? 'close the reactions' : 'add a reaction'}
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => setPicking((value) => !value)}
        style={styles.react}
      >
        <Label style={styles.reactLabel}>{picking ? '×' : 'react'}</Label>
      </Pressable>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    row: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 8,
    },
    grow: {
      flexShrink: 1,
      marginTop: -10,
    },
    react: {
      borderColor: colors.hair,
      borderRadius: radii.pill,
      borderStyle: 'dashed',
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    reactLabel: {
      color: colors.ink40,
    },
  }),
);
