/**
 * The health of the pager, which the control repository asks for once a day with
 * the signed body {"type": "health"}: the pager writes only when something needs
 * its maintainer, so a quiet day looks the same whether all is well or the pager
 * is dead. The answer says when the schedule last ran to its end and what last
 * failed in it, whether Telegram takes the token of the bot and delivers the updates of its webhook, whether
 * GitHub takes the key of the app, when the tokens of the maintainer expire, and
 * which version runs and which release of the pager it waits for.
 * It names no secret and nothing that an issue says, and changes nothing.
 */
import { describe } from "./context.ts";
import type { Context } from "./pager.ts";
import { type Token, type TokenState, watchedTokens } from "./tokens.ts";
import { awaited, VERSION } from "./version.ts";

/** The key of the time of the schedule's last run in the storage of the Durable Object. */
export const RAN = "schedule";

/** The longest message of an error that the answer carries, in characters. */
export const MAX_ERROR = 200;

/**
 * The key of the last thing that failed in a run of the schedule, in the storage
 * of the Durable Object (src/schedule.ts).
 */
export const FAILED = "scheduleFailure";

/** The last thing that failed in a run of the schedule. */
export interface Failure {
  /** When, in ISO 8601. */
  at: string;
  /** The step of the run and the thing, by its id, never by what it says. */
  what: string;
  /** What Telegram or GitHub answered, or the name of the error, cut to MAX_ERROR. */
  error: string;
}

/** What getWebhookInfo of the Bot API says, as far as the health reads it. */
interface WebhookInfo {
  url?: unknown;
  pending_update_count?: unknown;
  last_error_date?: unknown;
  last_error_message?: unknown;
}

/** The answer to {"type": "health"}. */
export interface Health {
  /** The version of the pager that runs, such as 1.2.3. */
  version: string;
  /**
   * The release of the pager's own repository that the Worker doesn't run yet,
   * with when GitHub published it, in ISO 8601, or null when it runs the latest
   * release that it heard of (src/version.ts).
   */
  release: { version: string; at: string } | null;
  /** When the schedule last ran to its end, in ISO 8601, or null when it never did. */
  schedule: string | null;
  /**
   * The last thing that failed in a run of the schedule, or null when none ever
   * did. A run where one did doesn't come to its end, so a failure after
   * `schedule` is one that the runs since haven't got past.
   */
  failure: Failure | null;
  telegram:
    | {
        ok: true;
        /** Whether a webhook is set, without which Telegram delivers nothing. */
        webhook: boolean;
        /** How many updates Telegram still holds for the webhook. */
        pending: number;
        /** The last error of the webhook, if Telegram keeps one. */
        lastError?: { at: string; message: string };
      }
    | { ok: false; error: string };
  github: { ok: true } | { ok: false; error: string };
  /** What the pager knows of each token that expires. */
  tokens: Partial<Record<Token, TokenState>>;
}

/** What a log or an answer may say of an error, cut to its first characters. */
export function errorOf(error: unknown): string {
  return describe(error).slice(0, MAX_ERROR);
}

async function telegram(context: Context): Promise<Health["telegram"]> {
  try {
    await context.telegram.call("getMe", {});
    const info = ((await context.telegram.call("getWebhookInfo", {})) ??
      {}) as WebhookInfo;
    const pending = info.pending_update_count;
    const date = info.last_error_date;
    return {
      ok: true,
      webhook: typeof info.url === "string" && info.url !== "",
      pending: Number.isSafeInteger(pending) ? (pending as number) : 0,
      ...(Number.isSafeInteger(date)
        ? {
            lastError: {
              at: new Date((date as number) * 1000).toISOString(),
              message: String(info.last_error_message ?? "").slice(
                0,
                MAX_ERROR,
              ),
            },
          }
        : {}),
    };
  } catch (error) {
    return { ok: false, error: errorOf(error) };
  }
}

async function github(context: Context): Promise<Health["github"]> {
  try {
    // GET /app with the JWT of the app: it proves the key and the id of the app.
    await context.github.appSettings();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorOf(error) };
  }
}

/** The health of the pager, as the control repository asks for it. */
export async function health(context: Context): Promise<Health> {
  const ran = await context.local.get<number>(RAN);
  const released = await awaited(context);
  return {
    version: VERSION,
    release:
      released === null
        ? null
        : {
            version: released.version,
            at: new Date(released.at).toISOString(),
          },
    schedule: ran === undefined ? null : new Date(ran).toISOString(),
    failure: (await context.local.get<Failure>(FAILED)) ?? null,
    telegram: await telegram(context),
    github: await github(context),
    tokens: await watchedTokens(context),
  };
}
