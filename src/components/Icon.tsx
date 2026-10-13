import type { AndroidSymbol } from 'expo-symbols';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { colors, radii, themed } from '../theme';
import { Label } from './Type';

/**
 * Every glyph the app draws, by what it means rather than what it looks
 * like: an SF Symbol on iOS and the matching Material Symbol on Android, the
 * same two families the tab bar's icons come from. A glyph is only ever on a
 * control, never decoration and never an empty state (LANGUAGE §7).
 */
const GLYPHS = {
  share: { sf: 'square.and.arrow.up', md: 'share' },
  edit: { sf: 'pencil', md: 'edit' },
  close: { sf: 'xmark', md: 'close' },
  external: { sf: 'arrow.up.right.square', md: 'open_in_new' },
  add: { sf: 'plus', md: 'add' },
  branch: { sf: 'arrow.triangle.branch', md: 'fork_right' },
  pull: { sf: 'arrow.triangle.pull', md: 'merge' },
  play: { sf: 'play', md: 'play_arrow' },
  log: { sf: 'doc.text', md: 'description' },
  reply: { sf: 'arrowshape.turn.up.left', md: 'reply' },
  send: { sf: 'paperplane', md: 'send' },
  done: { sf: 'checkmark.circle', md: 'check_circle' },
  notPlanned: { sf: 'nosign', md: 'block' },
  reopen: { sf: 'arrow.uturn.backward.circle', md: 'replay' },
  lock: { sf: 'lock', md: 'lock' },
  unlock: { sf: 'lock.open', md: 'lock_open' },
  pin: { sf: 'pin', md: 'push_pin' },
  assignMe: { sf: 'person.badge.plus', md: 'person_add' },
  react: { sf: 'face.smiling', md: 'add_reaction' },
  refresh: { sf: 'arrow.clockwise', md: 'refresh' },
  delete: { sf: 'trash', md: 'delete' },
  save: { sf: 'checkmark', md: 'check' },
  link: { sf: 'link', md: 'link' },
  gist: { sf: 'doc.on.doc', md: 'content_copy' },
  repo: { sf: 'folder.badge.plus', md: 'create_new_folder' },
  person: { sf: 'person', md: 'person' },
  dismiss: { sf: 'eye.slash', md: 'visibility_off' },
  expand: { sf: 'chevron.down', md: 'expand_more' },
  collapse: { sf: 'chevron.up', md: 'expand_less' },
  settings: { sf: 'slider.horizontal.3', md: 'tune' },
  server: { sf: 'server.rack', md: 'dns' },
  stop: { sf: 'stop', md: 'stop' },
  restart: { sf: 'arrow.triangle.2.circlepath', md: 'restart_alt' },
  pause: { sf: 'pause', md: 'pause' },
  archive: { sf: 'archivebox', md: 'inventory_2' },
  check: { sf: 'checklist', md: 'checklist' },
  search: { sf: 'magnifyingglass', md: 'search' },
  star: { sf: 'star', md: 'star' },
  watch: { sf: 'eye', md: 'visibility' },
  fork: { sf: 'tuningfork', md: 'call_split' },
  approve: { sf: 'checkmark.seal', md: 'verified' },
  merge: { sf: 'arrow.triangle.merge', md: 'merge' },
} satisfies Record<string, { sf: SFSymbol; md: AndroidSymbol }>;

export type Glyph = keyof typeof GLYPHS;

/** One glyph, in ink unless told otherwise. */
export function Icon({ name, size = 16, color }: { name: Glyph; size?: number; color?: string }) {
  const glyph = GLYPHS[name];
  return (
    <SymbolView
      name={{ ios: glyph.sf, android: glyph.md, web: glyph.md }}
      size={size}
      tintColor={color ?? colors.ink}
    />
  );
}

/**
 * A round outlined button holding one glyph — `share` on a chart's head,
 * `edit` beside a row. The words are still there for a screen reader, in
 * `label`; a sighted reader gets the glyph alone, the way a phone's own
 * share and edit buttons are drawn.
 */
export function IconButton({
  icon,
  label,
  onPress,
  on = false,
  size = 32,
  style,
}: {
  icon: Glyph;
  label: string;
  onPress: () => void;
  /** Open, or toggled on: filled, like an on chip. */
  on?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      hitSlop={6}
      onPress={onPress}
      // Border and fill change together: see the corner-radius trap.
      style={[
        styles.round,
        { height: size, width: size },
        on && styles.on,
        style,
      ]}
    >
      <Icon color={on ? colors.onBlack : colors.ink} name={icon} size={Math.round(size * 0.5)} />
    </Pressable>
  );
}

/**
 * A small outlined pill with a glyph and a short verb — what an underlined
 * line of text used to be: `branches`, `new file`, `logs`, `open on github`.
 * Pills are actions (LANGUAGE §5); a line of underlined words read as a
 * link in a paragraph, not as a button.
 */
export function IconPill({
  icon,
  label,
  onPress,
  on = false,
  hint,
  dim = false,
  style,
  children,
}: {
  icon?: Glyph;
  label: string;
  onPress: () => void;
  on?: boolean;
  hint?: string;
  /** A quieter pill, for the second thing in a row. */
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const ink = on ? colors.onBlack : dim ? colors.ink70 : colors.ink;
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      hitSlop={6}
      onPress={onPress}
      style={[styles.pill, on && styles.on, style]}
    >
      {icon ? <Icon color={ink} name={icon} size={14} /> : null}
      <Label numberOfLines={1} style={{ color: ink }}>
        {label}
      </Label>
      {children}
    </Pressable>
  );
}

/** A row of `IconPill`s, wrapping, never scrolling. */
export function PillRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = themed(() =>
  StyleSheet.create({
    round: {
      alignItems: 'center',
      borderColor: colors.hairStrong,
      borderRadius: radii.pill,
      borderWidth: 1,
      justifyContent: 'center',
    },
    on: {
      backgroundColor: colors.black,
      borderColor: colors.black,
    },
    pill: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      borderColor: colors.hairStrong,
      borderRadius: radii.pill,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
  }),
);
