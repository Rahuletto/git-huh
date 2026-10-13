import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { IconPill } from '../components/Icon';
import { Composer, type ComposerAction } from '../components/Composer';
import { StateChip } from '../components/StateChip';
import { Body, Data, Label, Micro } from '../components/Type';
import { useRemote } from '../hooks/useRemote';
import {
  approveRun,
  cancelRun,
  dispatchWorkflow,
  listRuns,
  listWorkflows,
  parseInputs,
  rerunAll,
  rerunFailed,
  toneOf,
  type RepoRun,
  type Workflow,
} from '../lib/checks';
import { listBranches, listPulls, type PullRow } from '../lib/explore';
import { GitHubError } from '../lib/github';
import { useNav } from '../lib/nav';
import type { RepoInfo } from '../lib/repo';
import { createBranch, deleteBranch } from '../lib/writes';
import { colors, radii, themed } from '../theme';
import { ago, Chips } from './shared';

export const WRITERS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);

// --- pull requests -------------------------------------------------------------

const DEMO_PULLS: PullRow[] = [
  {
    number: 142,
    title: 'feat: adaptive icon monochrome layer',
    author: 'octocat',
    draft: false,
    merged: false,
    createdAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
    head: 'octocat:monochrome-layer',
    base: 'main',
  },
  {
    number: 139,
    title: 'fix: widget reads the day in local time',
    author: 'annapetrova',
    draft: true,
    merged: false,
    createdAt: new Date(Date.now() - 80 * 3_600_000).toISOString(),
    head: 'annapetrova:widget-local-day',
    base: 'main',
  },
];

/** A repository's pull requests, open or closed, and the way to open a new one. */
export function Pulls({ repo, info }: { repo: string; info: RepoInfo | null }) {
  const nav = useNav();
  const [state, setState] = useState<'open' | 'closed'>('open');
  const demo = useMemo(() => (nav.demo ? (state === 'open' ? DEMO_PULLS : []) : undefined), [nav.demo, state]);
  const pulls = useRemote(
    nav.token ? `${nav.token}|pulls|${repo}|${state}` : null,
    (signal) => listPulls(nav.token ?? '', repo, state, signal),
    { cacheKey: nav.login ? `${nav.login.toLowerCase()}-pulls-${repo}-${state}` : null, demo },
  );

  return (
    <View>
      <View style={styles.headRow}>
        <Chips
          current={state}
          items={[
            { key: 'open', label: info ? `open ${info.openPulls}` : 'open' },
            { key: 'closed', label: 'closed' },
          ]}
          onSelect={setState}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => nav.open({ kind: 'new-pull', repo })}
          style={styles.solid}
        >
          <Label style={styles.solidLabel}>new pull request</Label>
        </Pressable>
      </View>
      {pulls.status === 'loading' && <Label style={styles.note}>reading the pull requests…</Label>}
      {pulls.status === 'error' && <Label style={styles.error}>could not read the pull requests</Label>}
      {pulls.status === 'ready' && pulls.data.length === 0 && (
        <Label style={styles.note}>{state === 'open' ? 'nothing open · nothing waiting' : 'nothing closed yet'}</Label>
      )}
      {pulls.status === 'ready' &&
        pulls.data.map((pull) => (
          <Pressable
            accessibilityRole="button"
            key={pull.number}
            onPress={() => nav.open({ kind: 'pull', repo, number: pull.number })}
            style={styles.row}
          >
            <View style={styles.rowTop}>
              <Data style={styles.number}>
                #{pull.number}
                {pull.draft ? ' · draft' : ''}
                {state === 'closed' ? (pull.merged ? ' · merged' : ' · closed') : ''}
              </Data>
              <Micro style={styles.age}>{ago(pull.createdAt)}</Micro>
            </View>
            <Body numberOfLines={2}>{pull.title}</Body>
            <Micro numberOfLines={1} style={styles.by}>
              ~{pull.author} · {pull.head} → {pull.base}
            </Micro>
          </Pressable>
        ))}
    </View>
  );
}

// --- branches ------------------------------------------------------------------

/**
 * Which branch the code tab is reading, and the branch verbs: switch to
 * another, make a new one from this one, delete this one, or propose it as a
 * pull request.
 */
export function Branches({
  repo,
  info,
  branch,
  onBranch,
}: {
  repo: string;
  info: RepoInfo | null;
  branch: string;
  onBranch: (branch: string) => void;
}) {
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const canWrite = WRITERS.has(info?.permission ?? '');
  const isDefault = !info || branch === info.defaultBranch;
  const branches = useRemote(
    nav.token && open ? `${nav.token}|branches|${repo}` : null,
    (signal) => listBranches(nav.token ?? '', repo, signal),
    {
      demo: nav.demo && open ? [{ name: 'main', protected: true }, { name: 'monochrome-layer', protected: false }] : undefined,
    },
  );

  return (
    <View style={styles.branches}>
      <View style={styles.branchRow}>
        <IconPill
          icon={open ? 'close' : 'branch'}
          label={branch || 'default branch'}
          on={open}
          onPress={() => setOpen(!open)}
        />
        {!isDefault && (
          <IconPill
            icon="pull"
            label="pull request"
            onPress={() => nav.open({ kind: 'new-pull', repo, head: branch })}
          />
        )}
      </View>

      {open && (
        <View style={styles.panel}>
          {branches.status === 'loading' && <Micro style={styles.age}>reading the branches…</Micro>}
          {branches.status === 'error' && <Micro style={styles.errorMicro}>could not read the branches</Micro>}
          {branches.status === 'ready' && (
            <Chips
              current={branch}
              items={branches.data.map((item) => ({
                key: item.name,
                label: item.name,
              }))}
              onSelect={(name) => {
                onBranch(name);
                setOpen(false);
              }}
            />
          )}
          {canWrite && (
            <Composer
              actions={[
                { key: 'create', label: `new branch from ${branch}`, primary: true },
                ...(!isDefault
                  ? [{ key: 'delete', label: `delete ${branch}`, allowEmpty: true, confirm: `delete ${branch}?` }]
                  : []),
              ]}
              compact
              demo={nav.demo}
              doing="that branch"
              onSubmit={async (action, text) => {
                const token = nav.token ?? '';
                if (action === 'delete') {
                  await deleteBranch(token, repo, branch);
                  onBranch(info?.defaultBranch ?? '');
                  branches.reload();
                  return `${branch} deleted`;
                }
                const name = text.replace(/\s+/g, '-');
                await createBranch(token, repo, name, branch);
                // GitHub lists a new branch a moment after making it.
                setTimeout(branches.reload, 2500);
                onBranch(name);
                return `${name} made from ${branch}`;
              }}
              placeholder="a new branch's name"
            />
          )}
        </View>
      )}
    </View>
  );
}

// --- actions ---------------------------------------------------------------------

const DEMO_WORKFLOWS: Workflow[] = [
  { id: 1, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' },
  { id: 2, name: 'release', path: '.github/workflows/release.yml', state: 'active' },
];

const DEMO_RUNS: RepoRun[] = [
  {
    id: 11,
    name: 'ci',
    status: 'completed',
    conclusion: 'failure',
    event: 'pull_request',
    url: '#',
    branch: 'monochrome-layer',
    title: 'feat: adaptive icon monochrome layer',
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    actor: 'octocat',
  },
  {
    id: 12,
    name: 'ci',
    status: 'in_progress',
    conclusion: null,
    event: 'push',
    url: '#',
    branch: 'main',
    title: 'chore: bump glance',
    createdAt: new Date(Date.now() - 0.2 * 3_600_000).toISOString(),
    actor: 'octocat',
  },
];

/**
 * A repository's Actions: its workflows, each one runnable by hand when it
 * has a `workflow_dispatch` trigger, and the latest runs with the buttons a
 * run can have — re-run, re-run the failed jobs, cancel, let a held one run.
 */
export function Actions({ repo, info }: { repo: string; info: RepoInfo | null }) {
  const nav = useNav();
  const [running, setRunning] = useState<number | null>(null);
  const canWrite = WRITERS.has(info?.permission ?? '');
  const owner = nav.login?.toLowerCase() ?? '';
  const workflows = useRemote(
    nav.token ? `${nav.token}|workflows|${repo}` : null,
    (signal) => listWorkflows(nav.token ?? '', repo, signal),
    { cacheKey: owner ? `${owner}-workflows-${repo}` : null, demo: nav.demo ? DEMO_WORKFLOWS : undefined },
  );
  const runs = useRemote(
    nav.token ? `${nav.token}|runs|${repo}` : null,
    (signal) => listRuns(nav.token ?? '', repo, signal),
    { cacheKey: owner ? `${owner}-runs-${repo}` : null, demo: nav.demo ? DEMO_RUNS : undefined },
  );
  const branch = info?.defaultBranch ?? 'main';

  return (
    <View>
      <Label style={styles.section}>workflows</Label>
      {workflows.status === 'loading' && <Label style={styles.note}>reading the workflows…</Label>}
      {workflows.status === 'error' && (
        <Label style={styles.error}>
          {workflows.error instanceof GitHubError && workflows.error.kind === 'missing'
            ? 'actions are off here · or this token cannot see them'
            : 'could not read the workflows'}
        </Label>
      )}
      {workflows.status === 'ready' && workflows.data.length === 0 && (
        <Label style={styles.note}>no workflows in this repository</Label>
      )}
      {workflows.status === 'ready' &&
        workflows.data.map((workflow) => (
          <View key={workflow.id} style={styles.row}>
            <View style={styles.rowTop}>
              <Data style={styles.number}>{workflow.name}</Data>
              {canWrite && workflow.state === 'active' && (
                <IconPill
                  icon={running === workflow.id ? 'close' : 'play'}
                  label={running === workflow.id ? 'close' : 'run'}
                  on={running === workflow.id}
                  onPress={() => setRunning(running === workflow.id ? null : workflow.id)}
                />
              )}
            </View>
            <Micro style={styles.by}>
              {workflow.path}
              {workflow.state !== 'active' ? ` · ${workflow.state.replace(/_/g, ' ')}` : ''}
            </Micro>
            {running === workflow.id && (
              <Composer
                actions={[{ key: 'run', label: `run on ${branch}`, primary: true, allowEmpty: true }]}
                compact
                demo={nav.demo}
                doing="that run"
                onSubmit={async (_, text) => {
                  await dispatchWorkflow(nav.token ?? '', repo, workflow.id, branch, parseInputs(text));
                  // A dispatched run takes a few seconds to be listed.
                  setTimeout(runs.reload, 3000);
                  setTimeout(runs.reload, 9000);
                  return 'started · it shows in the runs below in a moment';
                }}
                placeholder="inputs, one key=value a line · optional · needs a workflow_dispatch trigger"
              />
            )}
          </View>
        ))}

      <Label style={styles.section}>latest runs</Label>
      {runs.status === 'loading' && <Label style={styles.note}>reading the runs…</Label>}
      {runs.status === 'error' && <Label style={styles.error}>could not read the runs</Label>}
      {runs.status === 'ready' && runs.data.length === 0 && <Label style={styles.note}>nothing has run yet</Label>}
      {runs.status === 'ready' &&
        runs.data.map((run) => (
          <RunRow canWrite={canWrite} key={run.id} onChanged={runs.reload} repo={repo} run={run} />
        ))}
    </View>
  );
}

const TONE_WORD = { pass: 'passed', fail: 'failed', running: 'running', waiting: 'waiting', neutral: 'done' } as const;

function RunRow({
  run,
  repo,
  canWrite,
  onChanged,
}: {
  run: RepoRun;
  repo: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const nav = useNav();
  const token = nav.token ?? '';
  const tone = toneOf(run);
  const verbs: (ComposerAction & { run: () => Promise<string> })[] = [];
  if (canWrite && run.status === 'completed') {
    if (tone === 'fail') {
      verbs.push({
        key: 'failed',
        label: 're-run failed',
        primary: true,
        run: async () => {
          await rerunFailed(token, repo, run.id);
          return 'the failed jobs are running again';
        },
      });
    }
    verbs.push({
      key: 'all',
      label: 're-run all',
      run: async () => {
        await rerunAll(token, repo, run.id);
        return 'running again';
      },
    });
  }
  if (canWrite && (run.status === 'in_progress' || run.status === 'queued' || run.status === 'waiting')) {
    verbs.push({
      key: 'cancel',
      label: 'cancel',
      confirm: 'cancel it?',
      run: async () => {
        await cancelRun(token, repo, run.id);
        return 'cancelling';
      },
    });
  }
  if (canWrite && tone === 'waiting' && run.event === 'pull_request') {
    verbs.push({
      key: 'approve',
      label: 'approve and run',
      run: async () => {
        await approveRun(token, repo, run.id);
        return 'approved · it runs now';
      },
    });
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.runHead}>
          <StateChip
            text={TONE_WORD[tone]}
            tone={tone === 'pass' ? colors.yes : tone === 'fail' ? colors.no : colors.ink70}
          />
          <Data style={styles.number}>{run.name}</Data>
        </View>
        <Micro style={styles.age}>{ago(run.createdAt)}</Micro>
      </View>
      <Body numberOfLines={2}>{run.title}</Body>
      <Micro numberOfLines={1} style={styles.by}>
        {run.branch} · {run.event.replace(/_/g, ' ')} · ~{run.actor}
      </Micro>
      <View style={styles.runFoot}>
        {run.url !== '#' && (
          <IconPill
            dim
            icon="log"
            label="logs on github"
            onPress={() => Linking.openURL(run.url).catch(() => {})}
          />
        )}
      </View>
      {verbs.length > 0 && (
        <Composer
          actions={verbs}
          bare
          demo={nav.demo}
          doing="that"
          onSubmit={async (key) => {
            const verb = verbs.find((item) => item.key === key);
            const note = verb ? await verb.run() : '';
            setTimeout(onChanged, 1500);
            return note;
          }}
        />
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    headRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    section: {
      color: colors.ink,
      marginBottom: 4,
      marginTop: 18,
    },
    row: {
      borderTopColor: colors.hair,
      borderTopWidth: 1,
      gap: 3,
      paddingVertical: 11,
    },
    rowTop: {
      alignItems: 'baseline',
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    runHead: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    runFoot: {
      flexDirection: 'row',
      gap: 14,
      marginTop: 2,
    },
    number: {
      color: colors.ink,
      fontSize: 11,
    },
    age: {
      color: colors.ink40,
    },
    by: {
      color: colors.ink40,
    },
    branches: {
      marginTop: 12,
    },
    branchRow: {
      alignItems: 'baseline',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 14,
    },
    branchName: {
      color: colors.ink,
      fontSize: 12,
    },
    panel: {
      backgroundColor: colors.card,
      borderRadius: radii.tile,
      marginTop: 8,
      padding: 12,
    },
    solid: {
      backgroundColor: colors.black,
      borderColor: colors.black,
      borderRadius: radii.pill,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    solidLabel: {
      color: colors.onBlack,
    },
    note: {
      marginTop: 16,
    },
    error: {
      color: colors.no,
      lineHeight: 16,
      marginTop: 14,
    },
    errorMicro: {
      color: colors.no,
    },
  }),
);
