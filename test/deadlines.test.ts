// The deadlines of the calls to the network: a call to Telegram or GitHub that never
// answers, or whose answer never ends, ends at its deadline as an error of its API,
// so that the one queue of the Durable Object moves on.
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { makeContext } from "../src/context.ts";
import { DEADLINES, inTime, NO_ANSWER, timedOut } from "../src/deadlines.ts";
import { forget, GitHubError, NoAnswer } from "../src/github.ts";
import type { PagerEnv } from "../src/settings.ts";
import { type Fetch, TelegramError } from "../src/telegram.ts";
import { Net, never, START, settings } from "./helpers.ts";

const REPO = "Dennis-Otto/repo-pager";
const STORAGE = "https://storage.example/artifact.zip?sig=x";
/** Deadlines short enough for a test, the download's longer than a call's. */
const SHORT = { api: 20, download: 400 };

/** An answer whose body never ends, until the signal of its call does. */
function endless(signal: AbortSignal | null | undefined, status = 200) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(signal.reason));
    },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A context on the simulated network, with short deadlines, in which the calls
 * whose address ends with one of stalled answer as it says.
 */
async function context(
  stalled: Record<string, (init?: RequestInit) => Promise<Response> | Response>,
) {
  const net = new Net().on(
    "GET",
    `/repos/${REPO}/actions/artifacts/55/zip`,
    () => new Response(null, { status: 302, headers: { location: STORAGE } }),
  );
  const signals: Record<string, AbortSignal | null | undefined> = {};
  const fetcher: Fetch = (input, init) => {
    const url = String(input);
    signals[url] = init?.signal;
    const answer = Object.entries(stalled).find(([end]) => url.endsWith(end));
    return answer === undefined
      ? net.fetch(input, init)
      : Promise.resolve(answer[1](init));
  };
  const made = makeContext(
    await settings(),
    env as PagerEnv,
    fetcher,
    () => START,
    undefined,
    undefined,
    undefined,
    SHORT,
  );
  return { context: made, signals, net };
}

beforeEach(() => {
  forget();
});

describe("a deadline", () => {
  it("is a few seconds for a call and longer for the download of an artifact", () => {
    expect(DEADLINES).toEqual({ api: 5000, download: 20000 });
  });

  it("makes the end of a call at its deadline the error of its API, and passes on any other", async () => {
    const late = () => new Error("late");
    expect(await inTime(Promise.resolve(3), late)).toBe(3);
    await expect(
      inTime(
        Promise.reject(new DOMException("timed out", "TimeoutError")),
        late,
      ),
    ).rejects.toThrow("late");
    const aborted = new DOMException("aborted", "AbortError");
    await expect(inTime(Promise.reject(aborted), late)).rejects.toBe(aborted);
    const broken = new TypeError("network");
    await expect(inTime(Promise.reject(broken), late)).rejects.toBe(broken);
    expect(timedOut(new Error("TimeoutError"))).toBe(false);
  });

  it("comes with every call of the context, which a call of its own keeps", async () => {
    const { context: made, signals } = await context({});
    await made.telegram.call("getMe", {});
    const signal = signals["https://api.telegram.org/bot123:test/getMe"];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, SHORT.api * 3));
    expect(signal?.aborted).toBe(true);
    expect(timedOut(signal?.reason)).toBe(true);
    expect(made.subrequests()).toBe(1);
  });
});

describe("Telegram without an answer in time", () => {
  it("is a TelegramError, so that a webhook answers 500 and comes again", async () => {
    const { context: made } = await context({
      "/getMe": (init) => never(init?.signal),
    });
    const call = made.telegram.call("getMe", {});
    await expect(call).rejects.toThrow(TelegramError);
    await expect(call).rejects.toThrow(`Telegram getMe: ${NO_ANSWER}`);
  });

  it("is a TelegramError when its answer never ends", async () => {
    const { context: made } = await context({
      "/getMe": (init) => endless(init?.signal),
    });
    await expect(made.telegram.call("getMe", {})).rejects.toMatchObject({
      method: "getMe",
      description: NO_ANSWER,
    });
  });
});

describe("GitHub without an answer in time", () => {
  it("is a GitHubError, with the status of a gateway that waited in vain", async () => {
    const { context: made } = await context({
      [`/repos/${REPO}/installation`]: (init) => never(init?.signal),
    });
    const call = made.github.installation(REPO);
    await expect(call).rejects.toThrow(NoAnswer);
    await expect(call).rejects.toThrow(GitHubError);
    await expect(call).rejects.toThrow(`GitHub gave ${NO_ANSWER}`);
    await expect(call).rejects.toMatchObject({
      status: 504,
      detail: NO_ANSWER,
    });
  });

  it("is a GitHubError when its answer never ends, or its refusal", async () => {
    for (const status of [200, 500]) {
      const { context: made } = await context({
        [`/repos/${REPO}/installation`]: (init) =>
          endless(init?.signal, status),
      });
      await expect(made.github.installation(REPO)).rejects.toThrow(NoAnswer);
    }
  });

  it("gives the download of an artifact its own, longer deadline, for the answer and its body", async () => {
    const hanging = await context({ [STORAGE]: (init) => never(init?.signal) });
    const download = hanging.context.github.artifactZip(9, REPO, 55, 1000);
    // Past the deadline of a call, the download still waits.
    await new Promise((resolve) => setTimeout(resolve, SHORT.api * 5));
    expect(hanging.signals[STORAGE]?.aborted).toBe(false);
    await expect(download).rejects.toThrow(NoAnswer);
    expect(hanging.signals[STORAGE]?.aborted).toBe(true);
    const slow = await context({ [STORAGE]: (init) => endless(init?.signal) });
    await expect(
      slow.context.github.artifactZip(9, REPO, 55, 1000),
    ).rejects.toThrow(NoAnswer);
  });
});
