/**
 * How long a request may sit, and how much of an answer is worth keeping.
 *
 * A page that is still "loading" after a minute is not loading; GitHub never
 * answered. The deadline is the app's, composed with whatever cancellation
 * the screen already passed, so a stalled read settles even when nobody
 * unmounts it. A body past its budget is not silently shortened into a
 * complete-looking answer — the caller gets a bounded fallback and is told
 * the rest was left behind.
 */

import { GitHubError } from './github';

/** Reads wait this long; writes a little longer, because they may have landed. */
export const DEFAULT_READ_TIMEOUT_MS = 20_000;
export const DEFAULT_WRITE_TIMEOUT_MS = 45_000;

export interface ResponseBudget {
  /** Stop reading once this many bytes have arrived. */
  maxBytes?: number;
  /** Keep only this many lines of a text body. */
  maxLines?: number;
}

export interface BudgetResult {
  text: string;
  /** True when the body was larger than the budget and the rest was dropped. */
  truncated: boolean;
}

/**
 * The caller's abort and a deadline, as one signal.
 *
 * `timedOut` is true only when the deadline fired and the caller did not.
 * A press on back is a cancellation; a budget is a timeout. They ask for
 * different words, and a timed-out write is not the same as one that never
 * left the device.
 */
export function composeDeadline(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let fromDeadline = false;
  const timer = setTimeout(() => {
    fromDeadline = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => fromDeadline && !signal?.aborted,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/** A rejection that arrived because the deadline fired, not because the person cancelled. */
export function deadlineError(): GitHubError {
  return new GitHubError(
    'network',
    'GitHub did not answer in time.',
    'timeout',
  );
}

/**
 * Read a body up to a byte budget, then a line budget.
 *
 * Crossing either bound sets `truncated` rather than returning a string that
 * looks finished. No budget means the whole body, which is what a small JSON
 * answer wants.
 */
export async function readBounded(
  response: Response,
  budget: ResponseBudget = {},
): Promise<BudgetResult> {
  const advertised = Number(response.headers.get('content-length'));
  if (
    budget.maxBytes != null &&
    Number.isFinite(advertised) &&
    advertised > budget.maxBytes
  ) {
    return { text: '', truncated: true };
  }

  if (budget.maxBytes == null && budget.maxLines == null) {
    return { text: await response.text(), truncated: false };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return clipText(text, budget);
  }

  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let truncated = false;
  const cap = budget.maxBytes ?? Number.POSITIVE_INFINITY;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > cap) {
        const keep = value.byteLength - (bytes - cap);
        if (keep > 0) text += decoder.decode(value.subarray(0, keep), { stream: true });
        truncated = true;
        await reader.cancel();
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  text += decoder.decode();
  const clipped = clipText(text, budget);
  return { text: clipped.text, truncated: truncated || clipped.truncated };
}

function clipText(text: string, budget: ResponseBudget): BudgetResult {
  if (budget.maxBytes != null && text.length > budget.maxBytes) {
    text = text.slice(0, budget.maxBytes);
    return finish(text, budget, true);
  }
  return finish(text, budget, false);
}

function finish(text: string, budget: ResponseBudget, already: boolean): BudgetResult {
  if (budget.maxLines == null) return { text, truncated: already };
  const lines = text.split('\n');
  if (lines.length <= budget.maxLines) return { text, truncated: already };
  return { text: lines.slice(0, budget.maxLines).join('\n'), truncated: true };
}
