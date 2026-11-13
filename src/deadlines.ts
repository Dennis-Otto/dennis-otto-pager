/**
 * How long a call to the network may take. The Durable Object runs each change
 * after the one before (serial.ts), so a call to Telegram or GitHub that hangs
 * would hold every webhook of GitHub, every press of a button and the run of the
 * schedule behind it, and GitHub waits only ten seconds for the answer to a
 * webhook. So each call ends after a known time, and the paths that exist for an
 * error of an API handle it: the webhook answers 500 and comes again, and a
 * button answers with its text.
 */

/** The deadlines of the calls, in milliseconds. */
export interface Deadlines {
  /** A call to the API of Telegram or GitHub, with the reading of its answer. */
  api: number;
  /** The download of an artifact from GitHub's storage, which may take up to MAX_ARTIFACT. */
  download: number;
}

/**
 * Five seconds for a call, which both APIs answer in well under one, so two calls
 * that hang still leave an event its answer within GitHub's ten seconds; twenty for
 * the download of an artifact, which has megabytes to bring.
 */
export const DEADLINES: Deadlines = { api: 5000, download: 20000 };

/** What an error of an API says of a call that ran past its deadline. */
export const NO_ANSWER = "no answer in time";

/** Whether a call, or the reading of its answer, ended at the deadline of AbortSignal.timeout(). */
export function timedOut(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

/** The work of a call, whose end at its deadline becomes the error of its API. */
export function inTime<T>(work: Promise<T>, late: () => Error): Promise<T> {
  return work.catch((error: unknown) => {
    throw timedOut(error) ? late() : error;
  });
}
