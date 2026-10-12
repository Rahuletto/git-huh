import { useMemo } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { Composer } from '../components/Composer';
import { OverlayFrame, SavedNote } from '../components/Overlay';
import { Body, Data, Heading, Label, Micro } from '../components/Type';
import { useRemote } from '../hooks/useRemote';
import { fetchProfile, type Profile } from '../lib/explore';
import { GitHubError } from '../lib/github';
import { useNav } from '../lib/nav';
import { setFollowing } from '../lib/writes';
import { colors, space, themed } from '../theme';
import { ago, fmt } from './shared';

function demoProfile(login: string, isViewer: boolean): Profile {
  return {
    login,
    name: isViewer ? 'The Octocat' : login,
    bio: isViewer ? 'Ships widgets.' : 'Reviews pull requests on the train.',
    company: '',
    location: 'San Francisco',
    website: '',
    createdAt: '2011-01-25T18:44:36Z',
    followers: 4210,
    following: 9,
    viewerIsFollowing: isViewer ? null : false,
    isViewer,
    isOrganization: false,
    repos: [
      { nameWithOwner: `${login}/git-huh`, description: 'Make your own GitHub history worth looking at.', stars: 214, language: 'TypeScript', isPrivate: false },
      { nameWithOwner: `${login}/dotfiles`, description: '', stars: 3, language: 'Shell', isPrivate: false },
    ],
  };
}

/**
 * Someone on GitHub — a person or an organisation — opened from any `~name`
 * in the app: who they say they are, their repositories newest first, and
 * follow. Your own adds the things only you can make: a repository, a gist.
 */
export function UserScreen({ login }: { login: string }) {
  const nav = useNav();
  const isViewer = login.toLowerCase() === nav.login?.toLowerCase();
  const demo = useMemo(() => (nav.demo ? demoProfile(login, isViewer) : undefined), [isViewer, login, nav.demo]);
  const state = useRemote(
    nav.token ? `${nav.token}|user|${login}` : null,
    async (signal) => {
      const found = await fetchProfile(nav.token ?? '', login, signal);
      if (!found) throw new GitHubError('missing', 'Not found.');
      return found;
    },
    { cacheKey: nav.login ? `${nav.login.toLowerCase()}-user-${login.toLowerCase()}` : null, demo },
  );
  const profile = state.status === 'ready' ? state.data : null;

  return (
    <OverlayFrame onBack={nav.close} where={`~${login}`}>
      {state.status === 'ready' && <SavedNote offline={state.offline} savedAt={state.savedAt} />}
      {state.status === 'loading' && <Label style={styles.note}>looking them up…</Label>}
      {state.status === 'error' && (
        <Body style={styles.error}>
          {state.error instanceof GitHubError && state.error.kind === 'missing'
            ? 'github has nobody by that name'
            : 'could not read this profile'}
        </Body>
      )}
      {profile && (
        <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <Avatar login={profile.login} size={56} />
            <View style={styles.names}>
              <Heading style={styles.name}>{profile.name || profile.login}</Heading>
              <Data style={styles.handle}>
                ~{profile.login}
                {profile.isOrganization ? ' · organisation' : ''}
              </Data>
            </View>
          </View>
          {profile.bio ? <Body style={styles.bio}>{profile.bio}</Body> : null}
          <View style={styles.facts}>
            {!profile.isOrganization && (
              <Data style={styles.fact}>
                {fmt(profile.followers)} followers · {fmt(profile.following)} following
              </Data>
            )}
            {profile.company ? <Data style={styles.fact}>{profile.company}</Data> : null}
            {profile.location ? <Data style={styles.fact}>{profile.location}</Data> : null}
            <Data style={styles.fact}>on github {ago(profile.createdAt)}</Data>
          </View>
          {profile.website ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                const url = /^https?:/.test(profile.website) ? profile.website : `https://${profile.website}`;
                Linking.openURL(url).catch(() => {});
              }}
            >
              <Label style={styles.link}>{profile.website}</Label>
            </Pressable>
          ) : null}

          {profile.viewerIsFollowing !== null && !profile.isViewer && (
            <Composer
              actions={[
                {
                  key: 'follow',
                  label: profile.viewerIsFollowing ? 'following' : 'follow',
                  on: profile.viewerIsFollowing,
                },
              ]}
              bare
              demo={nav.demo}
              doing="that follow"
              onSubmit={async () => {
                await setFollowing(nav.token ?? '', profile.login, !profile.viewerIsFollowing);
                state.reload();
                return profile.viewerIsFollowing ? 'unfollowed' : `following ~${profile.login}`;
              }}
            />
          )}

          <View style={styles.links}>
            {!profile.isOrganization && (
              <Pressable
                accessibilityRole="button"
                onPress={() => nav.open({ kind: 'gists', login: profile.isViewer ? undefined : profile.login })}
              >
                <Label style={styles.link}>{profile.isViewer ? 'your gists' : 'gists'}</Label>
              </Pressable>
            )}
            {profile.isViewer && (
              <Pressable accessibilityRole="button" onPress={() => nav.open({ kind: 'new-repo' })}>
                <Label style={styles.link}>new repository</Label>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => nav.open({ kind: 'search', query: `user:${profile.login}` })}
            >
              <Label style={styles.link}>
                {profile.isViewer ? 'search your repositories' : 'search their repositories'}
              </Label>
            </Pressable>
          </View>

          <Label style={styles.section}>repositories · recently pushed</Label>
          {profile.repos.length === 0 && <Label style={styles.note}>nothing public here</Label>}
          {profile.repos.map((repo) => (
            <Pressable
              accessibilityRole="button"
              key={repo.nameWithOwner}
              onPress={() => nav.open({ kind: 'repo', repo: repo.nameWithOwner })}
              style={styles.row}
            >
              <View style={styles.rowTop}>
                <Data style={styles.repoName}>{repo.nameWithOwner.split('/')[1]}</Data>
                <Micro style={styles.meta}>
                  {repo.isPrivate ? 'private · ' : ''}★ {fmt(repo.stars)}
                </Micro>
              </View>
              {repo.description ? (
                <Body numberOfLines={2} style={styles.description}>
                  {repo.description}
                </Body>
              ) : null}
              {repo.language && <Micro style={styles.meta}>{repo.language}</Micro>}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </OverlayFrame>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    page: {
      paddingBottom: 30,
      paddingHorizontal: space.gutter,
      paddingTop: 6,
    },
    head: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 14,
    },
    names: {
      flex: 1,
      gap: 2,
    },
    name: {
      fontSize: 20,
      lineHeight: 26,
    },
    handle: {
      color: colors.ink40,
      fontSize: 12,
    },
    bio: {
      color: colors.ink70,
      marginTop: 12,
    },
    facts: {
      gap: 3,
      marginBottom: 8,
      marginTop: 10,
    },
    fact: {
      color: colors.ink70,
      fontSize: 11,
    },
    links: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 16,
      marginTop: 16,
    },
    link: {
      color: colors.ink70,
      textDecorationLine: 'underline',
    },
    section: {
      color: colors.ink,
      marginBottom: 4,
      marginTop: 22,
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
    repoName: {
      color: colors.ink,
      fontSize: 12,
    },
    description: {
      color: colors.ink70,
      fontSize: 13,
      lineHeight: 18,
    },
    meta: {
      color: colors.ink40,
    },
    note: {
      marginTop: 16,
      paddingHorizontal: space.gutter,
    },
    error: {
      color: colors.no,
      marginTop: 30,
      paddingHorizontal: space.gutter,
      textAlign: 'center',
    },
  }),
);
