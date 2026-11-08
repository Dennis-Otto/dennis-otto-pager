/**
 * The context of each request and of each run of the schedule: the settings, the
 * state, the two APIs and the texts of its language, which the tests make with a
 * simulated network and clock, and the storage of the Durable Object. It counts the calls to the network, which the
 * free plan of Workers allows 50 of per request.
 */
import { GitHub, GitHubError } from "./github.ts";
import type { Context } from "./pager.ts";
import type { PagerEnv, Settings } from "./settings.ts";
import { Store } from "./store.ts";
import { type Fetch, Telegram, TelegramError } from "./telegram.ts";
import { texts } from "./texts.ts";

/**
 * The storage of the one Durable Object, for the few small values that change
 * often, such as the time of the schedule's last run: in Workers KV, they would
 * take the writes of its free plan, 1000 a day, from the things.
 */
export interface Local {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/** A storage in memory, outside the Durable Object, as in the tests. */
export class Memory implements Local {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    // A copy, as the storage of a Durable Object hands out: a change of the
    // value changes nothing until it is put.
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

/** The context of a request: the settings, the state, the two APIs and the texts. */
export function makeContext(
  settings: Settings,
  env: PagerEnv,
  fetcher: Fetch = (input, init) => fetch(input, init),
  now: () => number = Date.now,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  exclusive: Context["exclusive"] = (work) => work(),
  local: Local = new Memory(),
): Context {
  let subrequests = 0;
  const counted: Fetch = (input, init) => {
    subrequests += 1;
    return fetcher(input, init);
  };
  return {
    settings,
    store: new Store(env.PAGER),
    telegram: new Telegram(settings.telegramToken, settings.chatId, counted),
    github: new GitHub(
      settings.appId,
      settings.appKey,
      settings.userToken,
      counted,
      now,
    ),
    t: texts(settings.language),
    now,
    sleep,
    exclusive,
    local,
    subrequests: () => subrequests,
  };
}

/** What a log may say of an error: the answers of the APIs, never more. */
export function describe(error: unknown): string {
  if (error instanceof GitHubError || error instanceof TelegramError) {
    return error.message;
  }
  return error instanceof Error ? error.name : "unknown error";
}
