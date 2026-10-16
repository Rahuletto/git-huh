import { GitHubError, type GitHubErrorKind } from './github';
import { explain } from './rest';

/** Plain data: failures must survive the same disk cache as successful reads. */
export interface ReadFailure {
  kind: GitHubErrorKind;
  message: string;
}

export type OptionalRead<T> =
  | { data: T; error: null }
  | { data: null; error: ReadFailure };

/** Isolate a supplemental read without hiding expiry, cancellation or programming errors. */
export async function optionalRead<T>(read: Promise<T>): Promise<OptionalRead<T>> {
  try {
    return { data: await read, error: null };
  } catch (error) {
    if (!(error instanceof GitHubError) || error.kind === 'invalid-token') throw error;
    return { data: null, error: { kind: error.kind, message: error.message } };
  }
}

export function explainReadFailure(failure: ReadFailure, subject: string): string {
  return explain(new GitHubError(failure.kind, failure.message), `loading ${subject}`);
}
