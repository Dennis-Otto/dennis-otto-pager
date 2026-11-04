/**
 * The context of each request and of each run of the schedule: the settings, the
 * state, the two APIs and the texts of its language, which the tests make with a
 * simulated network and clock.
 */
import { GitHub, GitHubError } from "./github.ts";
import type { Context } from "./pager.ts";
import type { PagerEnv, Settings } from "./settings.ts";
import { Store } from "./store.ts";
import { type Fetch, Telegram, TelegramError } from "./telegram.ts";
import { texts } from "./texts.ts";

/** The context of a request: the settings, the state, the two APIs and the texts. */
export function makeContext(
  settings: Settings,
  env: PagerEnv,
  fetcher: Fetch = (input, init) => fetch(input, init),
  now: () => number = Date.now,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  exclusive: Context["exclusive"] = (work) => work(),
): Context {
  return {
    settings,
    store: new Store(env.PAGER),
    telegram: new Telegram(settings.telegramToken, settings.chatId, fetcher),
    github: new GitHub(
      settings.appId,
      settings.appKey,
      settings.userToken,
      fetcher,
      now,
    ),
    t: texts(settings.language),
    now,
    sleep,
    exclusive,
  };
}

/** What a log may say of an error: the answers of the APIs, never more. */
export function describe(error: unknown): string {
  if (error instanceof GitHubError || error instanceof TelegramError) {
    return error.message;
  }
  return error instanceof Error ? error.name : "unknown error";
}
