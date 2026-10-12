import { GitHubError } from './github';

/**
 * Ask again while GitHub says "not there yet".
 *
 * Something made a second ago — a discussion, a release, a pull request —
 * can read as missing for a few seconds, because GitHub's reads lag its
 * writes. A page opened straight after making the thing would otherwise say
 * "could not find it" about the thing the person just made. Anything other
 * than a miss is passed straight through, and an abort stops the waiting.
 */
export async function eventually<T>(
  read: () => Promise<T | null>,
  {
    tries = 5,
    wait = 1500,
    signal,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    tries?: number;
    wait?: number;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const found = await read();
      if (found != null || attempt >= tries) return found;
    } catch (error) {
      const miss = error instanceof GitHubError && error.kind === 'missing';
      if (!miss || attempt >= tries) throw error;
    }
    if (signal?.aborted) return null;
    await sleep(wait);
  }
}
