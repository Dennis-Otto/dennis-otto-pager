/**
 * The tokens of the maintainer that expire, and the reminder three weeks before
 * each: the token of Claude in the control repository, whose day
 * CLAUDE_TOKEN_EXPIRES names; GITHUB_USER_TOKEN of the Worker, whose day GitHub
 * names in the header github-authentication-token-expiration of each answer,
 * which the schedule reads once a day from GET /rate_limit, a call that counts
 * against no limit; and PAGER_FIX_TOKEN of the control repository, whose day its
 * bodies carry as tokens.fix, such as that of its daily check of the health. What
 * the pager learned of them stays in the storage of its Durable Object, never a
 * token itself: a reminder names the token, the day and how to renew it.
 */
import { describe } from "./context.ts";
import { sha256Hex } from "./crypto.ts";
import { SUBREQUESTS } from "./deliveries.ts";
import { GitHubError, UserTokenRefused } from "./github.ts";
import { type Context, show } from "./pager.ts";
import { itemId, keys, type Reminder } from "./store.ts";
import type { Key } from "./texts.ts";

const DAY = 24 * 60 * 60 * 1000;
/** How many days before a token expires the pager reminds. */
export const REMIND_DAYS = 21;

/** The tokens of the maintainer that the pager watches. */
export type Token = "claude" | "user" | "fix";

/** What the pager knows of a token. */
export interface TokenState {
  /** The day it expires, such as 2026-12-03, or null when GitHub names none. */
  expires: string | null;
  /** The day since which GitHub refuses it, while it does. */
  refused?: string;
}

/** What the pager keeps of the tokens of GitHub, in the storage of its Durable Object. */
export interface Tokens {
  /** The day of the last check of GITHUB_USER_TOKEN, and which token it checked. */
  checked?: { day: string; token: string };
  user?: TokenState;
  fix?: TokenState;
}

/** The key of the tokens in the storage of the Durable Object. */
export const TOKENS = "tokens";

/** The day of a time, such as 2026-11-08, in UTC. */
export function dayOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Whether a value is a day such as 2026-12-03. */
function isDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/**
 * The day that github-authentication-token-expiration names, such as
 * "2026-12-03 10:00:00 UTC" or "2026-12-03 02:00:00 -0800", in UTC; null without
 * the header or for one that the pager can't read, which then reminds of nothing.
 */
export function expiryOf(header: string | null): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(
      header?.trim() ?? "",
    );
  if (match === null) {
    return null;
  }
  const zone = match[3] ?? "UTC";
  const offset = ["UTC", "Z"].includes(zone)
    ? "Z"
    : zone.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const time = Date.parse(`${match[1]}T${match[2]}${offset}`);
  return Number.isNaN(time) ? null : dayOf(time);
}

/** What the pager kept of the tokens of GitHub. */
export async function readTokens(context: Context): Promise<Tokens> {
  return (await context.local.get<Tokens>(TOKENS)) ?? {};
}

/**
 * The tokens that a body of the control repository names, such as
 * {"fix": "2026-12-03"}, or {"fix": null} for one that never expires; undefined
 * for none. A value that the pager doesn't know is passed over, so that a draft
 * never fails over the day of a token, and a newer control repository may name
 * more.
 */
export function tokensOf(value: unknown): { fix: string | null } | undefined {
  const fix = (value as { fix?: unknown } | null | undefined)?.fix;
  return fix === null || isDay(fix) ? { fix } : undefined;
}

/** Keep the day of PAGER_FIX_TOKEN that a body of the control repository named. */
export async function learnTokens(
  context: Context,
  named: { fix: string | null },
): Promise<void> {
  const tokens = await readTokens(context);
  if (tokens.fix?.expires === named.fix) {
    return;
  }
  tokens.fix = { expires: named.fix };
  await context.local.put(TOKENS, tokens);
}

/**
 * Ask GitHub, once a day, when GITHUB_USER_TOKEN expires, and whether it takes it
 * at all; a new token is asked about at once. An answer other than its 200 or 401,
 * such as during an outage of GitHub, goes to the log, and the next run asks again.
 */
async function checkUserToken(context: Context, tokens: Tokens): Promise<void> {
  const token = context.settings.userToken;
  if (token === null) {
    return;
  }
  // A short hash names which token was checked, never the token itself.
  const which = (await sha256Hex(token)).slice(0, 12);
  const today = dayOf(context.now());
  if (
    (tokens.checked?.day === today && tokens.checked.token === which) ||
    context.subrequests() >= SUBREQUESTS
  ) {
    // Checked today, or no call is left in this run: the next run asks.
    return;
  }
  const before = tokens.checked?.token === which ? tokens.user : undefined;
  try {
    tokens.user = {
      expires: expiryOf(await context.github.userTokenExpiration()),
    };
  } catch (error) {
    if (error instanceof UserTokenRefused) {
      tokens.user = {
        expires: before?.expires ?? null,
        refused: before?.refused ?? today,
      };
    } else if (error instanceof GitHubError) {
      console.error("The check of GITHUB_USER_TOKEN failed:", describe(error));
      return;
    } else {
      throw error;
    }
  }
  tokens.checked = { day: today, token: which };
  await context.local.put(TOKENS, tokens);
}

/** The texts of the reminder of each token. */
const TEXTS = {
  claude: {
    soon: "reminder.soon",
    expired: "reminder.expired",
  },
  user: {
    soon: "reminder.userSoon",
    expired: "reminder.userExpired",
  },
  fix: {
    soon: "reminder.fixSoon",
    expired: "reminder.fixExpired",
  },
} as const satisfies Record<Token, { soon: Key; expired: Key }>;

/** What a reminder of a token that is due says, and whether its day has come. */
interface Due {
  text: string;
  /** Whether the token expired, which pages once more, on its day. */
  expired: boolean;
  /** The day that the token expires; none while GitHub refuses it. */
  expires?: string;
}

/**
 * What the reminder of a token says now: from three weeks before its day, or
 * while GitHub refuses it, which only GITHUB_USER_TOKEN can be; null while none
 * is due.
 */
function dueOf(context: Context, token: Token, state: TokenState): Due | null {
  const { t } = context;
  if (state.refused !== undefined) {
    return { text: t("reminder.userRefused"), expired: false };
  }
  const { expires } = state;
  if (expires === null) {
    return null;
  }
  const left = Math.ceil(
    (Date.parse(`${expires}T00:00:00Z`) - context.now()) / DAY,
  );
  if (left > REMIND_DAYS) {
    return null;
  }
  const repo = context.settings.controlRepository;
  const date = t.date(expires);
  if (left <= 0) {
    return {
      text: t(TEXTS[token].expired, { repo, date }),
      expired: true,
      expires,
    };
  }
  return {
    text: t(TEXTS[token].soon, {
      repo,
      date,
      days:
        left === 1
          ? t("reminder.days.one")
          : t("reminder.days.many", { days: left }),
    }),
    expired: false,
    expires,
  };
}

/**
 * Make the text of the reminder of a token's day anew before it shows again, as
 * when ⏰ Later brings it back, so that it says how many days are left then, or
 * that the token expired. A reminder that names no day, such as that of a token
 * that GitHub refuses or one from before the pager kept the day, keeps its text.
 * Returns false when the token has another day by now, or is no longer watched,
 * since it was renewed or removed: the reminder of the old day is then over and
 * shows nothing new, rather than a countdown to a day that no longer applies.
 */
export async function refreshReminder(
  context: Context,
  item: Reminder,
): Promise<boolean> {
  if (item.expires === undefined) {
    return true;
  }
  const token = item.token ?? "claude";
  const current = (await watchedTokens(context))[token];
  if (current?.expires !== item.expires) {
    return false;
  }
  const due = dueOf(context, token, { expires: item.expires });
  if (due === null) {
    return true;
  }
  item.text = due.text;
  if (due.expired) {
    item.expired = true;
  }
  return true;
}

/**
 * The reminder of one token: once per token and day, or per day since GitHub
 * refuses it, and once more on the day that the token expires, as a new message
 * that notifies, whether the first is still open, put aside by ⏰ Later or closed
 * by ✅ Renewed while the day stayed the same. Returns its id, or null when none
 * is due or it came already.
 */
async function remindOf(
  context: Context,
  token: Token,
  state: TokenState,
): Promise<string | null> {
  const due = dueOf(context, token, state);
  if (due === null) {
    return null;
  }
  const name =
    state.refused === undefined
      ? `${token}-token:${state.expires}`
      : `${token}-token:refused:${state.refused}`;
  const id = await itemId(keys.reminder(name));
  // The id of a reminder names no other kind of thing.
  const known = (await context.store.get(id)) as Reminder | null;
  if (known !== null) {
    // A reminder from before the pager kept whether it said that the token
    // expired has said so when its text is already that of the expired token.
    if (!due.expired || known.expired === true || known.text === due.text) {
      return null;
    }
    known.state = "open";
    known.snoozedUntil = null;
    known.text = due.text;
    known.expired = true;
    await show(context, known, true);
    return id;
  }
  await show(context, {
    id,
    kind: "reminder",
    state: "open",
    repo: context.settings.controlRepository,
    installation: 0,
    messageId: null,
    note: null,
    snoozedUntil: null,
    text: due.text,
    ...(token === "claude" ? {} : { token }),
    ...(due.expires === undefined ? {} : { expires: due.expires }),
    ...(due.expired ? { expired: true as const } : {}),
  });
  return id;
}

/**
 * What the pager knows of each token that it watches: the token of Claude by its
 * setting, GITHUB_USER_TOKEN while it is set, and PAGER_FIX_TOKEN once the control
 * repository named its day.
 */
export async function watchedTokens(
  context: Context,
): Promise<Partial<Record<Token, TokenState>>> {
  const tokens = await readTokens(context);
  const expires = context.settings.tokenExpires;
  return {
    ...(expires === null ? {} : { claude: { expires } }),
    ...(context.settings.userToken === null || tokens.user === undefined
      ? {}
      : { user: tokens.user }),
    ...(tokens.fix === undefined ? {} : { fix: tokens.fix }),
  };
}

/**
 * The step of the schedule for the tokens: the check of GITHUB_USER_TOKEN once a
 * day, then the reminder of each token that is due. Returns the ids of the
 * reminders that it showed.
 */
export async function remindTokens(context: Context): Promise<string[]> {
  await checkUserToken(context, await readTokens(context));
  const shown: string[] = [];
  for (const [token, state] of Object.entries(await watchedTokens(context))) {
    const id = await remindOf(context, token as Token, state);
    if (id !== null) {
      shown.push(id);
    }
  }
  return shown;
}
