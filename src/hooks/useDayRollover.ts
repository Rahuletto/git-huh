import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * A counter that moves when the local calendar day does.
 *
 * Snooze expiry and "today" on the widget are functions of the clock, not of
 * a fetch. Nothing else in the app should re-render for that, so this lives
 * only where those values are computed. It ticks at the next local midnight
 * and again when the app comes back to the foreground on a later day — a
 * timezone change included, because the day is read from the clock, not from
 * a stored offset.
 */
export function useDayRollover(): number {
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let day = localDay(new Date());
    let timer: ReturnType<typeof setTimeout> | undefined;

    const bump = () => setEpoch((current) => current + 1);

    const arm = () => {
      if (timer) clearTimeout(timer);
      const now = new Date();
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      // A clock jump can land exactly on, or past, the boundary we aimed at.
      const wait = Math.max(next.getTime() - now.getTime(), 1000);
      timer = setTimeout(() => {
        day = localDay(new Date());
        bump();
        arm();
      }, wait);
    };

    const onChange = (state: string) => {
      if (state !== 'active') return;
      const today = localDay(new Date());
      if (today !== day) {
        day = today;
        bump();
      }
      arm();
    };

    arm();
    const subscription = AppState.addEventListener('change', onChange);
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return epoch;
}

/** YYYY-MM-DD in the local zone, so a timezone change is a new day. */
function localDay(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${date}`;
}
