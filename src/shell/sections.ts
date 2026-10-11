import type { AndroidSymbol } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';

export interface Section {
  key: 'today' | 'inbox' | 'work' | 'year' | 'ideas';
  /** The route file under `app/(tabs)/` — `index` is the first tab. */
  route: string;
  /** iOS SF Symbol, outline and filled. */
  sf: { default: SFSymbol; selected: SFSymbol };
  /** Android Material Symbol. */
  md: AndroidSymbol;
}

/**
 * Five sections, and every screen belongs to exactly one.
 *
 * Thirteen equal pages behind a scrolling rail make the answer to "where is
 * the thing I want" "swipe until it turns up". These are the four questions
 * the screens actually answer — what today
 * looks like, what wants me, what I am shipping, what the year was — plus
 * `ideas`, a device-local notebook for projects to build next.
 *
 * The grouping, the count and the shape all follow Apple's guidance: a flat
 * bar of persistent, labelled destinations (three to five), content and not
 * actions, no drawer, nothing behind a menu. There is no second row of tabs:
 * a section is **one page**, and what used to be its views are blocks on it,
 * in reading order (`src/shell/SectionScreen.tsx`). A list too long for the
 * page shows its head there and pushes the rest.
 */
export const SECTIONS: readonly Section[] = [
  {
    key: 'today',
    route: 'index',
    sf: { default: 'sun.max', selected: 'sun.max.fill' },
    md: 'light_mode',
  },
  {
    key: 'inbox',
    route: 'inbox',
    sf: { default: 'tray', selected: 'tray.fill' },
    md: 'inbox',
  },
  {
    key: 'work',
    route: 'work',
    sf: { default: 'arrow.triangle.pull', selected: 'arrow.triangle.pull' },
    md: 'merge',
  },
  {
    key: 'year',
    route: 'year',
    sf: { default: 'calendar', selected: 'calendar' },
    md: 'calendar_month',
  },
  {
    key: 'ideas',
    route: 'ideas',
    sf: { default: 'lightbulb', selected: 'lightbulb.fill' },
    md: 'lightbulb',
  },
];

/** The path a section lives at. */
export function hrefOf(index: number): '/' | `/${string}` {
  const route = SECTIONS[index]?.route ?? 'index';
  return route === 'index' ? '/' : `/${route}`;
}

/** Which section a path is, or 0 for anything else. */
export function sectionOfPath(pathname: string): number {
  const found = SECTIONS.findIndex((_, index) => hrefOf(index) === pathname);
  return found >= 0 ? found : 0;
}
