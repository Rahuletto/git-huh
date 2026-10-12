import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { OverlayFrame } from '../components/Overlay';
import { Body, Data, Label, Micro } from '../components/Type';
import { useRemote } from '../hooks/useRemote';
import { searchGitHub, type SearchHit, type SearchKind } from '../lib/explore';
import { GitHubError } from '../lib/github';
import { useNav } from '../lib/nav';
import { colors, space, themed } from '../theme';
import { SearchField } from './RepoScreen';
import { Chips, fmt } from './shared';

const KINDS: readonly { key: SearchKind; label: string }[] = [
  { key: 'repos', label: 'repositories' },
  { key: 'issues', label: 'issues' },
  { key: 'pulls', label: 'pull requests' },
  { key: 'users', label: 'people' },
];

function demoHits(kind: SearchKind, terms: string): { total: number; hits: SearchHit[] } {
  switch (kind) {
    case 'repos':
      return { total: 1, hits: [{ kind: 'repo', repo: 'octocat/git-huh', description: `a demo answer for “${terms}”`, stars: 214 }] };
    case 'users':
      return { total: 1, hits: [{ kind: 'user', login: 'annapetrova', name: 'Anna Petrova', bio: 'widgets, mostly' }] };
    default:
      return {
        total: 1,
        hits: [
          {
            kind: kind === 'pulls' ? 'pull' : 'issue',
            repo: 'octocat/git-huh',
            number: kind === 'pulls' ? 142 : 87,
            title: kind === 'pulls' ? 'feat: adaptive icon monochrome layer' : 'Widget stops updating after a theme change',
            state: 'OPEN',
            author: 'devonwrites',
          },
        ],
      };
  }
}

/**
 * GitHub's search, from the phone: repositories, issues, pull requests and
 * people, with the site's own qualifiers (`is:open`, `user:`, `label:`)
 * passed through as typed. Code search stays where it was — on `repos` and
 * inside each repository — because it is a different endpoint with a
 * different rate limit.
 */
export function SearchScreen({ query }: { query?: string }) {
  const nav = useNav();
  const [kind, setKind] = useState<SearchKind>('repos');
  const [draft, setDraft] = useState(query ?? '');
  const [terms, setTerms] = useState(query ?? '');

  const demo = useMemo(() => (nav.demo && terms ? demoHits(kind, terms) : undefined), [kind, nav.demo, terms]);
  const results = useRemote(
    nav.token && terms ? `${nav.token}|find|${kind}|${terms}` : null,
    (signal) => searchGitHub(nav.token ?? '', kind, terms, signal),
    { demo },
  );

  return (
    <OverlayFrame onBack={nav.close} where="search github">
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SearchField
          draft={draft}
          onChange={setDraft}
          onClear={() => {
            setDraft('');
            setTerms('');
          }}
          onSubmit={() => setTerms(draft.trim())}
          placeholder="search github"
          searching={terms.length > 0}
        />
        <View style={styles.kinds}>
          <Chips current={kind} items={KINDS} onSelect={setKind} />
        </View>
        {!terms && (
          <Micro style={styles.hint}>
            qualifiers work as on the site · is:open · label:bug · user:octocat · language:go
          </Micro>
        )}
        {results.status === 'loading' && <Label style={styles.note}>searching…</Label>}
        {results.status === 'error' && (
          <Label style={styles.error}>
            {results.error instanceof GitHubError && results.error.kind === 'forbidden'
              ? 'github is rate-limiting search · try again in a minute'
              : 'the search did not go through'}
          </Label>
        )}
        {results.status === 'ready' && (
          <>
            <Micro style={styles.hint}>
              {fmt(results.data.total)} found{results.data.total > results.data.hits.length ? ` · the first ${results.data.hits.length}` : ''}
            </Micro>
            {results.data.hits.map((hit, index) => (
              <Hit hit={hit} key={index} />
            ))}
          </>
        )}
      </ScrollView>
    </OverlayFrame>
  );
}

function Hit({ hit }: { hit: SearchHit }) {
  const nav = useNav();
  switch (hit.kind) {
    case 'repo':
      return (
        <Pressable accessibilityRole="button" onPress={() => nav.open({ kind: 'repo', repo: hit.repo })} style={styles.row}>
          <View style={styles.rowTop}>
            <Data style={styles.title}>{hit.repo}</Data>
            <Micro style={styles.meta}>★ {fmt(hit.stars)}</Micro>
          </View>
          {hit.description ? <Body numberOfLines={2} style={styles.body}>{hit.description}</Body> : null}
        </Pressable>
      );
    case 'user':
      return (
        <Pressable accessibilityRole="button" onPress={() => nav.open({ kind: 'user', login: hit.login })} style={styles.row}>
          <Data style={styles.title}>~{hit.login}</Data>
          {hit.name ? <Micro style={styles.meta}>{hit.name}</Micro> : null}
          {hit.bio ? <Body numberOfLines={2} style={styles.body}>{hit.bio}</Body> : null}
        </Pressable>
      );
    default:
      return (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            nav.open(
              hit.kind === 'pull'
                ? { kind: 'pull', repo: hit.repo, number: hit.number }
                : { kind: 'thread', repo: hit.repo, number: hit.number, type: 'issue' },
            )
          }
          style={styles.row}
        >
          <View style={styles.rowTop}>
            <Data numberOfLines={1} style={styles.meta}>
              {hit.repo} #{hit.number}
            </Data>
            <Micro style={styles.meta}>{hit.state.toLowerCase()}</Micro>
          </View>
          <Body numberOfLines={2}>{hit.title}</Body>
          <Micro style={styles.meta}>~{hit.author}</Micro>
        </Pressable>
      );
  }
}

const styles = themed(() =>
  StyleSheet.create({
    page: {
      paddingBottom: 30,
      paddingHorizontal: space.gutter,
      paddingTop: 6,
    },
    kinds: {
      marginTop: 12,
    },
    hint: {
      color: colors.ink40,
      marginBottom: 6,
      marginTop: 12,
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
      gap: 10,
      justifyContent: 'space-between',
    },
    title: {
      color: colors.ink,
      flexShrink: 1,
      fontSize: 12,
    },
    body: {
      color: colors.ink70,
      fontSize: 13,
      lineHeight: 18,
    },
    meta: {
      color: colors.ink40,
      flexShrink: 1,
    },
    note: {
      marginTop: 16,
    },
    error: {
      color: colors.no,
      marginTop: 14,
    },
  }),
);
