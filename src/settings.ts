/**
 * The settings of the pager: the variables of wrangler.jsonc and the secrets, which
 * live in Cloudflare only, set with `npx wrangler secret put NAME` as
 * docs/setup.md lists them.
 */

/** The secrets of the Worker, which `wrangler types` can't know. */
export interface Secrets {
  /** The token of the bot, from @BotFather. */
  TELEGRAM_BOT_TOKEN?: string;
  /** The secret_token of setWebhook, which Telegram sends with every update. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** The id of the maintainer's chat with the bot, the only one that is served. */
  TELEGRAM_CHAT_ID?: string;
  /** The secret of the webhook of the GitHub App. */
  GITHUB_WEBHOOK_SECRET?: string;
  /** The App ID of the GitHub App. */
  GITHUB_APP_ID?: string;
  /** The private key of the GitHub App, as GitHub hands it out (PEM). */
  GITHUB_APP_PRIVATE_KEY?: string;
  /** The secret with which the control repository signs what it sends back. */
  CONTROL_SECRET?: string;
  /**
   * A fine-grained token of the maintainer, for the two things that act in their
   * name: a reply that they approved, and the issue assistant past its rule.
   */
  GITHUB_USER_TOKEN?: string;
}

export type PagerEnv = Env & Secrets;

export interface Settings {
  telegramToken: string;
  telegramSecret: string;
  chatId: number;
  githubSecret: string;
  appId: string;
  appKey: string;
  controlSecret: string | null;
  userToken: string | null;
  maintainer: string;
  controlRepository: string;
  laterHours: number;
  tokenExpires: string | null;
}

/** The secrets without which the pager can't serve anything. */
export const REQUIRED = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_CHAT_ID",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
] as const;

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * The settings from the environment of the Worker, or the names of what is missing
 * or wrong; never their values.
 */
export function readSettings(
  env: PagerEnv,
): { settings: Settings } | { missing: string[] } {
  const missing: string[] = REQUIRED.filter(
    (name) => optional(env[name]) === null,
  );
  const chatId = Number(env.TELEGRAM_CHAT_ID);
  if (!missing.includes("TELEGRAM_CHAT_ID") && !Number.isSafeInteger(chatId)) {
    missing.push("TELEGRAM_CHAT_ID (a number)");
  }
  const laterHours = Number(env.LATER_HOURS);
  if (!(laterHours > 0 && laterHours <= 24 * 14)) {
    missing.push("LATER_HOURS (hours, from 1 to 336)");
  }
  const expires = optional(env.CLAUDE_TOKEN_EXPIRES);
  if (expires !== null && Number.isNaN(Date.parse(`${expires}T00:00:00Z`))) {
    missing.push("CLAUDE_TOKEN_EXPIRES (a date such as 2027-10-07)");
  }
  if (missing.length > 0) {
    return { missing };
  }
  return {
    settings: {
      telegramToken: String(env.TELEGRAM_BOT_TOKEN).trim(),
      telegramSecret: String(env.TELEGRAM_WEBHOOK_SECRET).trim(),
      chatId,
      githubSecret: String(env.GITHUB_WEBHOOK_SECRET).trim(),
      appId: String(env.GITHUB_APP_ID).trim(),
      appKey: String(env.GITHUB_APP_PRIVATE_KEY),
      controlSecret: optional(env.CONTROL_SECRET),
      userToken: optional(env.GITHUB_USER_TOKEN),
      maintainer: env.MAINTAINER_LOGIN,
      controlRepository: env.CONTROL_REPOSITORY,
      laterHours,
      tokenExpires: expires,
    },
  };
}
