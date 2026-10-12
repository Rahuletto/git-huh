import { useMemo } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Composer } from '../components/Composer';
import { OverlayFrame, SavedNote } from '../components/Overlay';
import { Body, Data, Heading, Label, Micro } from '../components/Type';
import { useRemote } from '../hooks/useRemote';
import { fetchGist, isGistStarred, listGists, type Gist, type GistRow } from '../lib/explore';
import { useNav } from '../lib/nav';
import { deleteGist, setGistStarred } from '../lib/writes';
import { colors, radii, space, themed } from '../theme';
import { ago } from './shared';

const DEMO_GISTS: GistRow[] = [
  {
    id: 'd3m0g1st',
    description: 'adb one-liners for the widget',
    files: ['widget.sh'],
    public: true,
    updatedAt: new Date(Date.now() - 50 * 3_600_000).toISOString(),
    owner: 'octocat',
  },
];

function demoGist(id: string): Gist {
  return {
    ...DEMO_GISTS[0],
    id,
    url: '#',
    contents: [
      {
        filename: 'widget.sh',
        text: 'adb shell am broadcast -a app.githuh.widget.REFRESH\nadb shell dumpsys gfxinfo app.githuh',
        truncated: false,
      },
    ],
  };
}

/** Someone's gists, or yours with the secret ones and `new gist`. */
export function GistsScreen({ login }: { login?: string }) {
  const nav = useNav();
  const mine = !login || login.toLowerCase() === nav.login?.toLowerCase();
  const state = useRemote(
    nav.token ? `${nav.token}|gists|${mine ? '' : login}` : null,
    (signal) => listGists(nav.token ?? '', mine ? null : (login ?? null), signal),
    {
      cacheKey: nav.login ? `${nav.login.toLowerCase()}-gists-${mine ? 'mine' : login?.toLowerCase()}` : null,
      demo: nav.demo ? DEMO_GISTS : undefined,
    },
  );

  return (
    <OverlayFrame onBack={nav.close} where={mine ? 'your gists' : `~${login} · gists`}>
      {state.status === 'ready' && <SavedNote offline={state.offline} savedAt={state.savedAt} />}
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        {mine && (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.open({ kind: 'new-gist' })}
            style={styles.solid}
          >
            <Label style={styles.solidLabel}>new gist</Label>
          </Pressable>
        )}
        {state.status === 'loading' && <Label style={styles.note}>reading the gists…</Label>}
        {state.status === 'error' && <Label style={styles.error}>could not read the gists</Label>}
        {state.status === 'ready' && state.data.length === 0 && (
          <Label style={styles.note}>no gists yet</Label>
        )}
        {state.status === 'ready' &&
          state.data.map((gist) => (
            <Pressable
              accessibilityRole="button"
              key={gist.id}
              onPress={() => nav.open({ kind: 'gist', id: gist.id })}
              style={styles.row}
            >
              <View style={styles.rowTop}>
                <Data numberOfLines={1} style={styles.title}>
                  {gist.files[0] ?? gist.id}
                  {gist.files.length > 1 ? ` +${gist.files.length - 1}` : ''}
                </Data>
                <Micro style={styles.meta}>
                  {gist.public ? '' : 'secret · '}
                  {ago(gist.updatedAt)}
                </Micro>
              </View>
              {gist.description ? <Body numberOfLines={2} style={styles.body}>{gist.description}</Body> : null}
            </Pressable>
          ))}
      </ScrollView>
    </OverlayFrame>
  );
}

/** One gist, every file in it, with star and — for your own — delete. */
export function GistScreen({ id }: { id: string }) {
  const nav = useNav();
  const demo = useMemo(() => (nav.demo ? demoGist(id) : undefined), [id, nav.demo]);
  const state = useRemote(
    nav.token ? `${nav.token}|gist|${id}` : null,
    (signal) => fetchGist(nav.token ?? '', id, signal),
    { cacheKey: nav.login ? `${nav.login.toLowerCase()}-gist-${id}` : null, demo },
  );
  const starred = useRemote(
    nav.token ? `${nav.token}|gist-star|${id}` : null,
    (signal) => isGistStarred(nav.token ?? '', id, signal),
    { demo: nav.demo ? false : undefined },
  );
  const gist = state.status === 'ready' ? state.data : null;
  const mine = gist?.owner.toLowerCase() === nav.login?.toLowerCase();
  const isStarred = starred.status === 'ready' && starred.data;

  return (
    <OverlayFrame onBack={nav.close} where={gist ? `~${gist.owner} · gist` : 'gist'}>
      {state.status === 'ready' && <SavedNote offline={state.offline} savedAt={state.savedAt} />}
      {state.status === 'loading' && <Label style={styles.note}>opening the gist…</Label>}
      {state.status === 'error' && <Label style={styles.error}>could not open this gist</Label>}
      {gist && (
        <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <Heading style={styles.heading}>{gist.description || gist.files[0] || gist.id}</Heading>
          <Micro style={styles.meta}>
            {gist.public ? 'public' : 'secret'} · updated {ago(gist.updatedAt)}
          </Micro>
          <Composer
            actions={[
              { key: 'star', label: isStarred ? '★ starred' : '☆ star', on: isStarred },
              ...(mine ? [{ key: 'delete', label: 'delete gist', confirm: 'delete it for good?' }] : []),
            ]}
            bare
            demo={nav.demo}
            doing="that"
            onSubmit={async (key) => {
              const token = nav.token ?? '';
              if (key === 'delete') {
                await deleteGist(token, gist.id);
                nav.close();
                return 'deleted';
              }
              await setGistStarred(token, gist.id, !isStarred);
              starred.reload();
              return isStarred ? 'unstarred' : 'starred';
            }}
          />
          {gist.contents.map((file) => (
            <View key={file.filename} style={styles.file}>
              <Data style={styles.title}>{file.filename}</Data>
              <View style={styles.code}>
                <Data selectable style={styles.codeText}>
                  {file.text}
                </Data>
              </View>
              {file.truncated && <Micro style={styles.meta}>the rest of this file is on github</Micro>}
            </View>
          ))}
          {gist.url !== '#' && (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(gist.url).catch(() => {})}>
              <Label style={styles.link}>open on github</Label>
            </Pressable>
          )}
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
    heading: {
      fontSize: 17,
      lineHeight: 23,
      marginBottom: 4,
    },
    solid: {
      alignSelf: 'flex-start',
      backgroundColor: colors.black,
      borderColor: colors.black,
      borderRadius: radii.pill,
      borderWidth: 1,
      marginBottom: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    solidLabel: {
      color: colors.onBlack,
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
    },
    file: {
      gap: 6,
      marginTop: 18,
    },
    code: {
      backgroundColor: colors.recess,
      borderRadius: radii.tile,
      padding: 10,
    },
    codeText: {
      color: colors.ink,
      fontSize: 11,
      lineHeight: 16,
    },
    link: {
      color: colors.ink70,
      marginTop: 18,
      textDecorationLine: 'underline',
    },
    note: {
      marginTop: 16,
      paddingHorizontal: space.gutter,
    },
    error: {
      color: colors.no,
      marginTop: 16,
      paddingHorizontal: space.gutter,
    },
  }),
);
