// The arguments of scripts/register-app.mjs, the page of GitHub to which it sends
// the manifest of the app: that of your personal account, or, with --org, that of
// an organization, which then owns the app; and what it says when something fails
// on the way. Node runs this file as it is, without a build;
// test/register-app.test.ts tests it, and test/register-app-script.mjs the script.
import { isLogin } from "../src/settings.ts";

/** How to call scripts/register-app.mjs. */
export const USAGE =
  "node scripts/register-app.mjs https://repo-pager.ACCOUNT.workers.dev [--org ORGANIZATION]";

/** What scripts/register-app.mjs registers: the app of a Worker, for an account. */
export interface Registration {
  /** The address of the Worker, without a slash at its end. */
  worker: string;
  /** The organization that owns the app, or null for your personal account. */
  organization: string | null;
}

/** The registration that the arguments ask for, or what is wrong with them. */
export function registration(args: readonly string[]): Registration | string {
  let worker: string | null = null;
  let organization: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--org" || arg.startsWith("--org=")) {
      const value =
        arg === "--org" ? (args[++index] ?? "") : arg.slice("--org=".length);
      if (!isLogin(value)) {
        return "Name the organization after --org by its login, such as --org octo-org";
      }
      organization = value;
    } else if (arg.startsWith("-")) {
      return `Unknown option ${arg}`;
    } else if (worker === null) {
      worker = arg.replace(/\/+$/, "");
    } else {
      return `One address of the Worker, not also ${arg}`;
    }
  }
  if (worker === null || !/^https:\/\/[a-z0-9.-]+$/i.test(worker)) {
    return "Name the address of the Worker, such as https://repo-pager.ACCOUNT.workers.dev";
  }
  return { worker, organization };
}

/**
 * The page of GitHub that lists the apps of the organization, which must allow you
 * to manage its apps, or of your account.
 */
export function appsPage(organization: string | null): string {
  const account = organization === null ? "" : `organizations/${organization}/`;
  return `https://github.com/${account}settings/apps`;
}

/** The page of GitHub that registers an app from a manifest, in appsPage(). */
export function newAppPage(organization: string | null, state: string): string {
  return `${appsPage(organization)}/new?state=${encodeURIComponent(state)}`;
}

/**
 * The settings of the app by its slug, where you make a new private key and set the
 * secret of its webhook; their page `/advanced` deletes the app.
 */
export function appSettingsPage(
  organization: string | null,
  slug: string,
): string {
  return `${appsPage(organization)}/${encodeURIComponent(slug)}`;
}

/** The secrets of the Worker that the registration stores, in their order. */
export const APP_SECRETS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
] as const;

/** One of APP_SECRETS. */
export type AppSecret = (typeof APP_SECRETS)[number];

/** How to store a missing secret by hand, from the settings page of the app. */
const BY_HAND: Record<AppSecret, string> = {
  GITHUB_APP_ID:
    "copy its App ID from the top of the page into `npx wrangler secret put GITHUB_APP_ID`",
  GITHUB_APP_PRIVATE_KEY:
    "generate a private key at its end and store the file that GitHub downloads with `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < FILE.pem`, then delete the file",
  GITHUB_WEBHOOK_SECRET:
    "set a new, long and random secret of the webhook there and store the same with `npx wrangler secret put GITHUB_WEBHOOK_SECRET`",
};

/**
 * What to do when the app exists on GitHub but not every secret reached the Worker:
 * GitHub hands out the private key and the secret of the webhook only once, in the
 * conversion of the manifest, so the script can't fetch them again. The text names
 * the secrets, never their values.
 */
export function recovery(
  organization: string | null,
  slug: string,
  stored: readonly AppSecret[],
): string {
  const missing = APP_SECRETS.filter((name) => !stored.includes(name));
  const settings = appSettingsPage(organization, slug);
  return [
    `The app ${slug} exists on GitHub, but Wrangler stored only some of its secrets in the Worker.`,
    `Stored: ${stored.length === 0 ? "none" : stored.join(", ")}. Missing: ${missing.join(", ")}.`,
    "GitHub hands out the private key and the secret of the webhook only once, so running the script again can't fetch them. Fix what Wrangler said, then either:",
    `- open ${settings} and ${missing.map((name) => BY_HAND[name]).join("; ")}; or`,
    `- delete the app at ${settings}/advanced and run the script again.`,
  ].join("\n");
}

/**
 * What to do when the conversion of the manifest failed: nothing is in the Worker,
 * though GitHub may have created the app already.
 */
export function conversionFailed(
  organization: string | null,
  reason: string,
): string {
  return [
    `${reason}. Nothing is stored in the Worker.`,
    `If ${appsPage(organization)} lists the new app, delete it on its page Advanced, then run the script again.`,
  ].join("\n");
}

/** What to do when Wrangler can't reach the secrets of the Worker. */
export const WRANGLER_NOT_READY = [
  "Wrangler can't list the secrets of the Worker that wrangler.jsonc names, so it couldn't store those of the app either.",
  "Sign in with `npx wrangler login` and deploy the Worker with `npm run deploy`, as docs/setup.md shows, then run the script again.",
  "Nothing was created on GitHub.",
].join("\n");
