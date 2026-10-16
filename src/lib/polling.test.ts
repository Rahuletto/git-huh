import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pollWhileForeground, type ActivitySource } from './polling';

function activity(initial: string | null = 'active') {
  const listeners = new Set<(state: string) => void>();
  const source: ActivitySource = {
    currentState: initial,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return {
    source,
    listeners,
    change(state: string) {
      source.currentState = state;
      listeners.forEach((listener) => listener(state));
    },
  };
}

test('polling pauses in background and refreshes once on foreground', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const app = activity();
  let calls = 0;
  const dispose = pollWhileForeground(() => { calls++; }, 10, app.source);
  t.after(dispose);
  t.mock.timers.tick(10_000);
  assert.equal(calls, 1);
  app.change('inactive');
  app.change('background');
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
  app.change('active');
  assert.equal(calls, 2);
  app.change('active');
  assert.equal(calls, 2);
  t.mock.timers.tick(10_000);
  assert.equal(calls, 3);
});

test('a background or unknown initial state starts no polling timer', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const initial of ['background', null]) {
    const app = activity(initial);
    let calls = 0;
    const dispose = pollWhileForeground(() => { calls++; }, 5, app.source);
    t.mock.timers.tick(60_000);
    assert.equal(calls, 0);
    app.change('active');
    assert.equal(calls, 1);
    dispose();
  }
});

test('hiding or disposing a page removes timers and activity listeners', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const app = activity();
  let calls = 0;
  const dispose = pollWhileForeground(() => { calls++; }, 5, app.source);
  const queuedListener = [...app.listeners][0];
  dispose();
  assert.equal(app.listeners.size, 0);
  app.change('background');
  app.change('active');
  queuedListener('background');
  queuedListener('active');
  t.mock.timers.tick(60_000);
  assert.equal(calls, 0);
});

test('polling clamps short intervals and handles malformed intervals', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const [seconds, delay] of [[0, 5000], [-2, 5000], [NaN, 10000], [Infinity, 10000]]) {
    let calls = 0;
    const dispose = pollWhileForeground(() => { calls++; }, seconds, activity().source);
    t.mock.timers.tick(delay - 1);
    assert.equal(calls, 0);
    t.mock.timers.tick(1);
    assert.equal(calls, 1);
    dispose();
  }
});

test('restarting after a request waits a full interval instead of refreshing immediately', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const app = activity();
  let calls = 0;
  const reload = () => { calls++; };
  const first = pollWhileForeground(reload, 5, app.source);
  t.mock.timers.tick(5000);
  first(); // the hook disables polling while a request is in flight
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
  const next = pollWhileForeground(reload, 5, app.source);
  t.after(next);
  assert.equal(calls, 1);
  t.mock.timers.tick(4999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal(calls, 2);
});
