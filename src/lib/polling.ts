export interface ActivitySource {
  currentState: string | null;
  subscribe: (listener: (state: string) => void) => () => void;
}

/** Poll only in the foreground; waking refreshes once without waiting a full interval. */
export function pollWhileForeground(reload: () => void, seconds: number, activity: ActivitySource) {
  const interval = Math.max(5, Number.isFinite(seconds) ? seconds : 10) * 1000;
  let foreground = activity.currentState === 'active';
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    timer = setInterval(() => {
      if (!disposed && foreground) reload();
    }, interval);
  };
  if (foreground) start();
  const unsubscribe = activity.subscribe((state) => {
    if (disposed) return;
    const next = state === 'active';
    if (next === foreground) return;
    foreground = next;
    stop();
    if (foreground) {
      start();
      reload();
    }
  });
  return () => {
    disposed = true;
    stop();
    unsubscribe();
  };
}
