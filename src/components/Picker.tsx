import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useRemote } from '../hooks/useRemote';
import { useNav } from '../lib/nav';
import { colors, fonts, radii, themed } from '../theme';
import { Composer } from './Composer';
import { Label, Micro } from './Type';

export interface Option {
  key: string;
  label: string;
}

/**
 * Choose from one of a repository's lists — its labels, the people who can
 * be assigned, its milestones — and save the choice in one write. The list
 * is fetched when the picker opens, filtered as you type, and what is
 * already chosen is filled. Chips wrap; nothing scrolls sideways.
 */
export function Picker({
  what,
  loadKey,
  load,
  demo,
  current,
  multi = true,
  allowNone = false,
  onSave,
  onClose,
}: {
  /** `labels`, `assignees`: what the empty and failed lines name. */
  what: string;
  loadKey: string;
  load: (signal: AbortSignal) => Promise<Option[]>;
  demo?: Option[];
  current: string[];
  multi?: boolean;
  /** Single choice that can also be cleared — no milestone. */
  allowNone?: boolean;
  onSave: (chosen: string[]) => Promise<string>;
  onClose: () => void;
}) {
  const nav = useNav();
  const [chosen, setChosen] = useState<string[]>(current);
  const [filter, setFilter] = useState('');
  const options = useRemote(nav.token ? `${nav.token}|${loadKey}` : null, load, {
    demo: nav.demo ? (demo ?? []) : undefined,
  });

  const toggle = (key: string) =>
    setChosen((was) =>
      multi
        ? was.includes(key)
          ? was.filter((item) => item !== key)
          : [...was, key]
        : was.includes(key)
          ? []
          : [key],
    );

  const all = options.status === 'ready' ? options.data : [];
  // Chosen ones stay in view whatever the filter says.
  const shown = all.filter(
    (option) =>
      chosen.includes(option.key) || option.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const changed =
    chosen.length !== current.length || chosen.some((key) => !current.includes(key));

  return (
    <View style={styles.panel}>
      {all.length > 12 && (
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setFilter}
          placeholder={`find ${what}`}
          placeholderTextColor={colors.ink40}
          style={styles.filter}
          value={filter}
        />
      )}
      {options.status === 'loading' && <Micro style={styles.note}>reading the {what}…</Micro>}
      {options.status === 'error' && <Micro style={styles.failed}>could not read the {what}</Micro>}
      {options.status === 'ready' && all.length === 0 && (
        <Micro style={styles.note}>this repository has no {what}</Micro>
      )}
      <View style={styles.chips}>
        {shown.slice(0, 60).map((option) => {
          const on = chosen.includes(option.key);
          return (
            <Pressable
              accessibilityRole={multi ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: on }}
              key={option.key}
              onPress={() => toggle(option.key)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Label style={on ? styles.chipLabelOn : styles.chipLabel}>{option.label}</Label>
            </Pressable>
          );
        })}
      </View>
      <Composer
        actions={[
          {
            key: 'save',
            label: allowNone && chosen.length === 0 ? `clear the ${what}` : `save ${what}`,
            primary: true,
            disabled: !changed,
          },
        ]}
        bare
        demo={nav.demo}
        doing={`those ${what}`}
        onCancel={onClose}
        onSubmit={() => onSave(chosen)}
      />
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    panel: {
      backgroundColor: colors.card,
      borderRadius: radii.tile,
      marginTop: 8,
      padding: 12,
    },
    filter: {
      borderColor: colors.hair,
      borderRadius: radii.pill,
      borderWidth: 1,
      color: colors.ink,
      fontFamily: fonts.mono,
      fontSize: 12,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    chip: {
      borderColor: colors.hair,
      borderRadius: radii.pill,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    chipOn: {
      backgroundColor: colors.black,
      borderColor: colors.black,
    },
    chipLabel: {
      color: colors.ink,
    },
    chipLabelOn: {
      color: colors.onBlack,
    },
    note: {
      color: colors.ink40,
      marginBottom: 6,
    },
    failed: {
      color: colors.no,
      marginBottom: 6,
    },
  }),
);
