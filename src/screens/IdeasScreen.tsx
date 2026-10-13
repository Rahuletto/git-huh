import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Card } from '../components/Card';
import { Meter } from '../components/HostPanel';
import { IconButton, IconPill } from '../components/Icon';
import { Body, Data, Heading, Label, Micro } from '../components/Type';
import {
  counts,
  newIdea,
  ordered,
  progress,
  repoName,
  splitIdea,
  STAGES,
  update,
  type ProjectIdea,
  type Stage,
} from '../lib/ideas';
import { ideasStore } from '../lib/ideasStorage';
import { useNav } from '../lib/nav';
import { colors, fonts, radii, space, themed, type } from '../theme';
import { ago, Chips, ScreenHead } from './shared';

type Filter = Stage | 'all';

/** The time of a change, read when the change is made — never while drawing. */
const clock = () => Date.now();

/** What each stage is called on its chip, in the order they are offered. */
const STAGE_WORDS: Record<Stage, string> = {
  idea: 'idea',
  next: 'next',
  building: 'building',
  shipped: 'shipped',
  parked: 'parked',
};

/**
 * `ideas` — a notebook of projects, from a line you jotted down to a
 * repository you shipped.
 *
 * Every idea is a note whose first line is its name. It moves through
 * stages — `idea`, `next` (the short list), `building`, `shipped`, or
 * `parked` (put away, not thrown away) — carries a checklist of steps with
 * its progress as dots, and, once it is started, the repository it became:
 * `make a repository` opens the new-repository form named after it and
 * links the two. Everything stays on this device; nothing is sent to GitHub
 * until a repository is asked for.
 */
export function IdeasScreen({ demo, active }: { demo: boolean; active: boolean }) {
  const store = useMemo(() => ideasStore(demo), [demo]);
  const [ideas, setIdeas] = useState<ProjectIdea[] | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);

  const load = useCallback(
    () =>
      store.load().then(
        (saved) => {
          setIdeas(saved);
          setError(null);
        },
        () => {
          setError('could not read saved ideas · try again');
        },
      ),
    [store],
  );
  // Read again whenever the section comes back: a repository made from an
  // idea on a pushed page is linked to it there.
  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const persist = async (next: ProjectIdea[], afterSave?: () => void) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await store.save(next);
      setIdeas(next);
      afterSave?.();
    } catch {
      setError('could not save on this device · your changes are still here');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const change = (id: string, edit: (idea: ProjectIdea) => Partial<ProjectIdea>) => {
    if (ideas) void persist(update(ideas, id, edit, clock()));
  };

  const reset = () => {
    setText('');
    setEditing(null);
    Keyboard.dismiss();
  };
  const save = () => {
    if (ideas === null || !text.trim()) return;
    const next = editing
      ? update(ideas, editing, () => ({ text: text.trim() }), clock())
      : [newIdea(text, clock(), filter === 'all' ? 'idea' : filter), ...ideas];
    void persist(next, reset);
  };

  const tally = ideas ? counts(ideas) : null;
  const shown = ideas ? ordered(ideas).filter((idea) => filter === 'all' || idea.stage === filter) : [];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        ref={scroll}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHead
          left="project ideas"
          right={tally === null ? undefined : `${tally.building} building · ${tally.all} saved`}
        />
        <Micro style={styles.dim}>{demo ? 'demo notebook · saved on this device' : 'saved on this device · nothing leaves it'}</Micro>
        {error && (
          <Body accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Body>
        )}

        {ideas === null ? (
          error ? (
            <IconPill icon="refresh" label="try again" onPress={load} />
          ) : (
            <Body>opening your ideas…</Body>
          )
        ) : (
          <>
            {tally && tally.all > 0 && (
              <Chips
                current={filter}
                items={[
                  { key: 'all' as Filter, label: `all ${tally.all}` },
                  ...STAGES.filter((stage) => tally[stage] > 0 || stage === filter).map((stage) => ({
                    key: stage as Filter,
                    label: `${STAGE_WORDS[stage]} ${tally[stage]}`,
                  })),
                ]}
                onSelect={setFilter}
              />
            )}

            <Card title={editing ? 'edit idea' : filter === 'all' || filter === 'idea' ? 'something to build' : `add to ${filter}`}>
              <TextInput
                accessibilityLabel="project idea"
                editable={!busy}
                multiline
                onChangeText={setText}
                placeholder={'a name on the first line\nnotes under it'}
                placeholderTextColor={colors.ink40}
                ref={input}
                style={styles.input}
                textAlignVertical="top"
                value={text}
              />
              <View style={styles.actions}>
                <IconPill
                  icon={editing ? 'save' : 'add'}
                  label={busy ? 'saving…' : editing ? 'save changes' : 'add idea'}
                  on={!!text.trim()}
                  onPress={save}
                />
                {editing && <IconPill icon="close" label="cancel" onPress={reset} />}
              </View>
            </Card>

            {ideas.length === 0 && (
              <Body style={styles.empty}>no ideas yet · the next project starts here</Body>
            )}
            {ideas.length > 0 && shown.length === 0 && (
              <Body style={styles.empty}>nothing {filter} right now</Body>
            )}

            {shown.map((idea) => (
              <IdeaCard
                busy={busy}
                idea={idea}
                key={idea.id}
                onChange={(edit) => change(idea.id, edit)}
                onDelete={() => {
                  void persist(
                    ideas.filter((item) => item.id !== idea.id),
                    () => {
                      if (editing === idea.id) reset();
                    },
                  );
                }}
                onEdit={() => {
                  setEditing(idea.id);
                  setText(idea.text);
                  setError(null);
                  scroll.current?.scrollTo({ y: 0, animated: true });
                  input.current?.focus();
                }}
                onToggle={() => setOpen(open === idea.id ? null : idea.id)}
                open={open === idea.id}
              />
            ))}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * One idea. Closed, it is its name, its stage and its progress; open, its
 * notes, the stages to move it through, its steps, and the way to the
 * repository it became or will become.
 */
function IdeaCard({
  idea,
  open,
  busy,
  onToggle,
  onChange,
  onEdit,
  onDelete,
}: {
  idea: ProjectIdea;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onChange: (edit: (idea: ProjectIdea) => Partial<ProjectIdea>) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const nav = useNav();
  const { title, notes } = splitIdea(idea.text);
  const { done, total } = progress(idea);
  const [step, setStep] = useState('');
  const [deleting, setDeleting] = useState(false);

  const addStep = () => {
    const text = step.trim();
    if (!text) return;
    onChange((current) => ({
      steps: [...current.steps, { id: `${clock()}-${current.steps.length}`, text, done: false }],
    }));
    setStep('');
  };

  return (
    <Card style={idea.stage === 'parked' ? styles.parked : undefined}>
      <Pressable
        accessibilityHint={open ? 'closes it' : 'opens its notes, steps and stages'}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.head}
      >
        <View style={styles.headTop}>
          <View style={[styles.stage, idea.stage === 'building' && styles.stageOn]}>
            <Micro style={idea.stage === 'building' ? styles.stageOnText : styles.stageText}>
              {STAGE_WORDS[idea.stage]}
            </Micro>
          </View>
          {total > 0 && (
            <Micro style={styles.dim}>
              {done} of {total}
            </Micro>
          )}
          <View style={styles.flex} />
          <Micro style={styles.dim}>{ago(new Date(idea.updatedAt).toISOString())}</Micro>
        </View>
        <Heading style={styles.title}>{title}</Heading>
        {notes ? (
          <Body numberOfLines={open ? undefined : 2} selectable={open} style={styles.notes}>
            {notes}
          </Body>
        ) : null}
        {total > 0 && <Meter cells={Math.min(24, Math.max(total, 8))} percent={(100 * done) / total} />}
        {idea.repo && !open ? <Data style={styles.repo}>{idea.repo}</Data> : null}
      </Pressable>

      {open && (
        <View style={styles.body}>
          <Micro style={styles.section}>stage</Micro>
          <Chips
            current={idea.stage}
            items={STAGES.map((stage) => ({ key: stage, label: STAGE_WORDS[stage] }))}
            onSelect={(stage) => onChange(() => ({ stage }))}
          />

          <Micro style={styles.section}>steps</Micro>
          {idea.steps.map((item) => (
            <View key={item.id} style={styles.step}>
              <Pressable
                accessibilityLabel={item.text}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                disabled={busy}
                hitSlop={6}
                onPress={() =>
                  onChange((current) => ({
                    steps: current.steps.map((s) => (s.id === item.id ? { ...s, done: !s.done } : s)),
                  }))
                }
                style={styles.stepHit}
              >
                <View style={[styles.check, item.done ? styles.checkOn : styles.checkOff]} />
                <Body style={[styles.stepText, item.done && styles.stepDone]}>{item.text}</Body>
              </Pressable>
              <IconButton
                icon="close"
                label={`remove the step ${item.text}`}
                onPress={() => onChange((current) => ({ steps: current.steps.filter((s) => s.id !== item.id) }))}
                size={26}
                style={styles.quiet}
              />
            </View>
          ))}
          <View style={styles.addStep}>
            <TextInput
              accessibilityLabel="a new step"
              editable={!busy}
              onChangeText={setStep}
              // Keeps the keyboard up, so several steps go in one after another.
              blurOnSubmit={false}
              onSubmitEditing={addStep}
              placeholder="a step towards it"
              placeholderTextColor={colors.ink40}
              returnKeyType="done"
              style={styles.stepInput}
              value={step}
            />
            <IconButton icon="add" label="add the step" on={!!step.trim()} onPress={addStep} size={34} />
          </View>

          <View style={styles.actions}>
            {idea.repo ? (
              <IconPill
                icon="repo"
                label={idea.repo}
                onPress={() => nav.open({ kind: 'repo', repo: idea.repo ?? '' })}
              />
            ) : (
              <IconPill
                hint="opens the new repository form, named after this idea"
                icon="repo"
                label="make a repository"
                onPress={() =>
                  nav.open({
                    kind: 'new-repo',
                    name: repoName(title),
                    description: notes.split('\n')[0]?.slice(0, 200) ?? '',
                    idea: idea.id,
                  })
                }
              />
            )}
            <IconButton icon="edit" label="edit the idea" onPress={onEdit} />
            <IconButton
              icon="delete"
              label={deleting ? 'press again to delete it' : 'delete the idea'}
              on={deleting}
              onPress={() => (deleting ? onDelete() : setDeleting(true))}
            />
            {deleting && (
              <>
                <Label style={styles.error}>delete it?</Label>
                <IconPill icon="close" label="keep" onPress={() => setDeleting(false)} />
              </>
            )}
          </View>
          {idea.repo && (
            <Pressable
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => onChange(() => ({ repo: null }))}
            >
              <Micro style={styles.dim}>linked to {idea.repo} · tap to unlink</Micro>
            </Pressable>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    fill: { flex: 1 },
    flex: { flex: 1 },
    page: { gap: 10, paddingBottom: 28, paddingHorizontal: space.gutter, paddingTop: 6 },
    dim: { color: colors.ink40 },
    input: {
      ...type.body,
      borderColor: colors.hair,
      borderRadius: radii.tile,
      borderWidth: 1,
      color: colors.ink,
      minHeight: 90,
      padding: 12,
    },
    actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    empty: { color: colors.ink70, padding: space.card },
    error: { color: colors.no },
    parked: { opacity: 0.6 },
    head: { gap: 6 },
    headTop: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    // Fill and border change together: see the corner-radius trap.
    stage: {
      borderColor: colors.hairStrong,
      borderRadius: radii.pill,
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 1,
    },
    stageOn: { backgroundColor: colors.black, borderColor: colors.black },
    stageText: { color: colors.ink70 },
    stageOnText: { color: colors.onBlack },
    title: { fontFamily: fonts.monoMedium, fontSize: 15, lineHeight: 21 },
    notes: { color: colors.ink70 },
    repo: { color: colors.ink40, fontSize: 11 },
    body: { borderTopColor: colors.hair, borderTopWidth: 1, marginTop: 12, paddingTop: 4 },
    section: { color: colors.ink40, marginBottom: 6, marginTop: 12 },
    step: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 36 },
    stepHit: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10, paddingVertical: 4 },
    check: { borderRadius: 7, borderWidth: 1.5, height: 14, width: 14 },
    checkOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    checkOff: { backgroundColor: 'transparent', borderColor: colors.ink40 },
    stepText: { color: colors.ink, flex: 1 },
    stepDone: { color: colors.ink40, textDecorationLine: 'line-through' },
    quiet: { borderColor: 'transparent' },
    addStep: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 6 },
    stepInput: {
      ...type.body,
      borderColor: colors.hair,
      borderRadius: radii.pill,
      borderWidth: 1,
      color: colors.ink,
      flex: 1,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
  }),
);
