import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { explain } from '../lib/rest';
import { colors, fonts, radii, themed } from '../theme';
import { Label, Micro } from './Type';

export interface ComposerAction {
  key: string;
  label: string;
  /** Filled black: the one thing on the row that is the point. */
  primary?: boolean;
  /** Approving says enough on its own; everything else needs words. */
  allowEmpty?: boolean;
  /**
   * What the pill says after the first press. Anything that cannot be taken
   * back — merge, delete — is pressed twice: once to arm, once to send.
   */
  confirm?: string;
  /** A toggle in its on state — starred, watching, your reaction. */
  on?: boolean;
  /** Not available right now, for a reason the screen says nearby. */
  disabled?: boolean;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'armed'; action: string }
  | { kind: 'sending'; action: string }
  | { kind: 'sent'; note: string }
  | { kind: 'failed'; note: string };

/**
 * Where you write back. One box, one row of verbs, and a line under them that
 * says what happened in words — `sent`, or exactly why not.
 *
 * Every write in the app goes through this, which is what keeps the rule
 * honest: the button names the thing it does (`approve`, `request changes`,
 * `comment on line 42`), nothing is sent until you press it, and a failure
 * leaves your text in the box rather than eating it.
 *
 * `bare` is the same row without the box, for the writes that are only a
 * verb: merge, star, lock, a reaction. A form that has fields of its own puts
 * them above a bare composer and reads them in `onSubmit`.
 */
export function Composer({
  placeholder,
  actions,
  onSubmit,
  doing = 'that',
  demo = false,
  compact = false,
  bare = false,
  quiet = false,
  initial = '',
  onCancel,
}: {
  placeholder?: string;
  actions: ComposerAction[];
  /** Resolves with the line to show when it worked. Throws when it did not. */
  onSubmit: (action: string, text: string) => Promise<string>;
  doing?: string;
  demo?: boolean;
  compact?: boolean;
  /** No box: the row of verbs alone. */
  bare?: boolean;
  /** Say nothing when it worked — a reaction is its own receipt. */
  quiet?: boolean;
  /** What is in the box to begin with — an edit starts from what was said. */
  initial?: string;
  /** A `cancel` pill, for a box opened to edit something. */
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const busy = phase.kind === 'sending';

  const send = async (action: ComposerAction) => {
    if (busy || action.disabled) return;
    if (!bare && !action.allowEmpty && text.trim().length === 0) return;
    if (action.confirm && !(phase.kind === 'armed' && phase.action === action.key)) {
      setPhase({ kind: 'armed', action: action.key });
      return;
    }
    setPhase({ kind: 'sending', action: action.key });
    try {
      if (demo) {
        setPhase({ kind: 'sent', note: 'demo account · nothing was sent' });
        return;
      }
      const note = await onSubmit(action.key, text.trim());
      if (!bare) setText('');
      setPhase(quiet ? { kind: 'idle' } : { kind: 'sent', note });
    } catch (error) {
      setPhase({ kind: 'failed', note: explain(error, doing) });
    }
  };

  return (
    <View style={[styles.box, compact && styles.compact, bare && styles.bare]}>
      {!bare && (
      <TextInput
        editable={!busy}
        multiline
        onChangeText={(value) => {
          setText(value);
          if (phase.kind !== 'idle' && phase.kind !== 'sending') setPhase({ kind: 'idle' });
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.ink40}
        style={[styles.input, compact && styles.inputCompact]}
        textAlignVertical="top"
        value={text}
      />
      )}
      <View style={styles.actions}>
        {actions.map((action) => {
          const disabled =
            busy || action.disabled || (!bare && !action.allowEmpty && text.trim().length === 0);
          const armed = phase.kind === 'armed' && phase.action === action.key;
          const filled = action.primary || action.on || armed;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled,
                busy: busy && phase.action === action.key,
                ...(action.on !== undefined ? { selected: action.on } : {}),
              }}
              disabled={disabled}
              key={action.key}
              onPress={() => send(action)}
              // Border and fill change together: see the corner-radius trap.
              style={[styles.pill, filled && styles.primary, disabled && styles.disabled]}
            >
              <Label style={filled ? styles.primaryLabel : styles.label}>
                {busy && phase.action === action.key
                  ? 'sending…'
                  : armed
                    ? (action.confirm ?? action.label)
                    : action.label}
              </Label>
            </Pressable>
          );
        })}
        {onCancel && (
          <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.pill}>
            <Label style={styles.label}>cancel</Label>
          </Pressable>
        )}
      </View>
      {phase.kind === 'sent' && <Micro style={styles.sent}>{phase.note}</Micro>}
      {phase.kind === 'failed' && <Micro style={styles.failed}>{phase.note}</Micro>}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    box: {
      borderTopColor: colors.ink,
      borderTopWidth: 1,
      gap: 10,
      marginTop: 22,
      paddingTop: 12,
    },
    bare: {
      borderTopWidth: 0,
      marginTop: 10,
      paddingTop: 0,
    },
    compact: {
      borderTopColor: colors.hair,
      marginTop: 6,
      paddingTop: 8,
    },
    input: {
      backgroundColor: colors.card,
      borderColor: colors.hair,
      borderRadius: radii.tile,
      borderWidth: 1,
      color: colors.ink,
      fontFamily: fonts.mono,
      fontSize: 14,
      lineHeight: 20,
      minHeight: 84,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    inputCompact: {
      minHeight: 60,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    pill: {
      borderColor: colors.hair,
      borderRadius: radii.pill,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    primary: {
      backgroundColor: colors.black,
      borderColor: colors.black,
    },
    disabled: {
      opacity: 0.4,
    },
    label: {
      color: colors.ink,
    },
    primaryLabel: {
      color: colors.onBlack,
    },
    sent: {
      color: colors.yes,
    },
    failed: {
      color: colors.no,
    },
  }),
);
