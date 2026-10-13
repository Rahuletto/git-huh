import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Card } from '../components/Card';
import { Machine, ServiceRows } from '../components/HostParts';
import { Body, Data, Heading, Label, Micro } from '../components/Type';
import { demoOverview } from '../lib/host';
import { colors, fonts, radii, space, themed } from '../theme';

/** One turn of the light through the preview, and of a request down the wire. */
const TURN = 2800;
/** How tall the wire between two nodes of the diagram is. */
const WIRE = 46;

/** Read once, when the preview is made — never while drawing. */
const nowSeconds = () => Date.now() / 1000;

/**
 * What the `host` tab is, shown until a machine is connected: one sentence,
 * a diagram of where the numbers come from, the page as it will look —
 * drawn from the demo host, with a light sweeping through it so it reads as
 * a preview and not as data — and the three steps to set it up.
 *
 * Everything moves on one looping value on the native driver (LANGUAGE §6),
 * and it stops when the tab is not on screen.
 */
export function HostIntro({ active }: { active: boolean }) {
  const { width } = useWindowDimensions();
  const cardWidth = width - space.gutter * 2;
  // Ages in the preview read from now (`up for 3d 4h`), not from a fixed date.
  const [preview] = useState(() => demoOverview(nowSeconds()));
  const [turn] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) return;
    turn.setValue(0);
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: TURN, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, turn]);

  return (
    <>
      <Card>
        <Heading style={styles.lede}>your computer, from your phone</Heading>
        <Body style={styles.body}>
          a small server on your machine, <Data style={styles.code}>hostd</Data>, keeps an eye
          on it and on everything you run there. this tab asks it over your tailnet: is the
          machine alright, is each service up and answering, what did it last log. restart
          one from here, and add any graph or list of your own in its config.
        </Body>
      </Card>

      <Card title="how it fits together">
        <Diagram turn={turn} />
      </Card>

      <View style={styles.previewHead}>
        <Label>what it will look like</Label>
        <Micro style={styles.dim}>demo numbers</Micro>
      </View>
      <View accessibilityLabel="a preview of the host page with demo numbers" pointerEvents="none" style={styles.preview}>
        <Sweep count={3} index={0} turn={turn}>
          <Machine data={preview} width={cardWidth} />
        </Sweep>
        <Sweep count={3} index={2} turn={turn}>
          <ServiceRows services={preview.services} />
        </Sweep>
      </View>

      <Card title="set it up">
        {[
          ['run hostd on the machine', 'it makes a token the first time it starts'],
          ['put this phone on the same tailnet', 'the tailscale app, signed in to the same account'],
          ['give this tab the address and the token', 'the machine’s …ts.net name, port 8796'],
        ].map(([what, how], index) => (
          <View key={what} style={[styles.step, index > 0 && styles.stepLine]}>
            <View style={styles.stepNumber}>
              <Micro style={styles.stepDigit}>{index + 1}</Micro>
            </View>
            <View style={styles.stepText}>
              <Data style={styles.stepWhat}>{what}</Data>
              <Micro style={styles.dim}>{how}</Micro>
            </View>
          </View>
        ))}
      </Card>
    </>
  );
}

/**
 * The preview's blocks brighten one after another as the light passes, the
 * way the loading card's dots do — so the page reads as not-yet-yours.
 */
function Sweep({
  turn,
  index,
  count,
  children,
}: {
  turn: Animated.Value;
  index: number;
  count: number;
  children: ReactNode;
}) {
  const at = (index + 0.5) / count;
  const opacity = turn.interpolate({
    inputRange: [0, Math.max(0.001, at - 0.3), at, Math.min(0.999, at + 0.3), 1],
    outputRange: [0.32, 0.32, 0.72, 0.32, 0.32],
  });
  return <Animated.View style={[styles.sweep, { opacity }]}>{children}</Animated.View>;
}

/**
 * This tab, the tailnet, the machine, and what the machine reports — nodes
 * on a dotted wire, a dot travelling down it for each request.
 */
function Diagram({ turn }: { turn: Animated.Value }) {
  return (
    <View>
      <Node detail="git-huh · on this phone" name="this tab" />
      <Wire label="asks every 10 s, over your tailnet" turn={turn} />
      <Node detail="hostd · one small server, its own config" name="your machine" strong />
      <Wire label="which reads" turn={turn} delay={0.5} />
      <View style={styles.leaves}>
        {[
          ['the machine', 'cpu · memory · heat · disks'],
          ['services', 'up or down · answering'],
          ['logs and actions', 'read them · restart · stop'],
          ['your own panels', 'any command, file or api'],
        ].map(([name, detail]) => (
          <View key={name} style={styles.leaf}>
            <Data style={styles.leafName}>{name}</Data>
            <Micro style={styles.dim}>{detail}</Micro>
          </View>
        ))}
      </View>
    </View>
  );
}

function Node({ name, detail, strong = false }: { name: string; detail: string; strong?: boolean }) {
  return (
    <View style={[styles.node, strong && styles.nodeStrong]}>
      <Data style={styles.nodeName}>{name}</Data>
      <Micro style={styles.dim}>{detail}</Micro>
    </View>
  );
}

function Wire({ turn, label, delay = 0 }: { turn: Animated.Value; label: string; delay?: number }) {
  // The same loop, shifted, so the two wires do not carry their dots in step.
  const travel = turn.interpolate({
    inputRange: delay ? [0, delay, delay + 0.001, 1] : [0, 1],
    outputRange: delay ? [WIRE * (1 - delay), WIRE, 0, WIRE * (1 - delay)] : [0, WIRE],
  });
  // Fades out at the bottom and back in at the top, so the jump is not seen.
  const fade = delay
    ? turn.interpolate({
        inputRange: [0, delay - 0.08, delay, delay + 0.001, delay + 0.08, 1],
        outputRange: [1, 1, 0, 0, 1, 1],
      })
    : turn.interpolate({ inputRange: [0, 0.08, 0.92, 1], outputRange: [0, 1, 1, 0] });
  return (
    <View style={styles.wire}>
      <View style={styles.wireTrack}>
        {Array.from({ length: Math.floor(WIRE / 7) }, (_, index) => (
          <View key={index} style={styles.wireDot} />
        ))}
        <Animated.View style={[styles.packet, { opacity: fade, transform: [{ translateY: travel }] }]} />
      </View>
      <Micro style={styles.wireLabel}>{label}</Micro>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    lede: {
      fontFamily: fonts.light,
      fontSize: 20,
      lineHeight: 26,
      marginBottom: 8,
    },
    body: {
      color: colors.ink70,
    },
    code: {
      color: colors.ink,
      fontSize: 12,
    },
    dim: {
      color: colors.ink40,
    },
    previewHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 6,
      paddingHorizontal: 4,
    },
    preview: {
      gap: 10,
    },
    sweep: {
      gap: 10,
    },
    node: {
      borderColor: colors.hairStrong,
      borderRadius: radii.tile,
      borderWidth: 1,
      gap: 2,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    nodeStrong: {
      backgroundColor: colors.recess,
      borderColor: colors.recess,
    },
    nodeName: {
      color: colors.ink,
      fontFamily: fonts.monoMedium,
      fontSize: 13,
    },
    wire: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
      height: WIRE,
      paddingLeft: 22,
    },
    wireTrack: {
      alignItems: 'center',
      height: WIRE,
      justifyContent: 'space-evenly',
      width: 8,
    },
    wireDot: {
      backgroundColor: colors.ink20,
      borderRadius: 1.5,
      height: 3,
      width: 3,
    },
    packet: {
      backgroundColor: colors.ink,
      borderRadius: 4,
      height: 8,
      left: 0,
      position: 'absolute',
      top: -4,
      width: 8,
    },
    wireLabel: {
      color: colors.ink40,
      flex: 1,
    },
    leaves: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    leaf: {
      borderColor: colors.hair,
      borderRadius: radii.tile,
      borderWidth: 1,
      flexBasis: '47%',
      flexGrow: 1,
      gap: 2,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    leafName: {
      color: colors.ink,
      fontSize: 12,
    },
    step: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 10,
    },
    stepLine: {
      borderTopColor: colors.hair,
      borderTopWidth: 1,
    },
    stepNumber: {
      alignItems: 'center',
      borderColor: colors.hairStrong,
      borderRadius: 11,
      borderWidth: 1,
      height: 22,
      justifyContent: 'center',
      width: 22,
    },
    stepDigit: {
      color: colors.ink,
    },
    stepText: {
      flex: 1,
      gap: 2,
    },
    stepWhat: {
      color: colors.ink,
      fontSize: 12,
    },
  }),
);
