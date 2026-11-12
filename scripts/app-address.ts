// The arguments of scripts/register-app.mjs, and the page of GitHub to which it
// sends the manifest of the app: that of your personal account, or, with --org,
// that of an organization, which then owns the app. Node runs this file as it is,
// without a build; test/register-app.test.ts tests it.
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
 * The page of GitHub that registers an app from a manifest: under the settings of
 * the organization, which must allow you to manage its apps, or of your account.
 */
export function newAppPage(organization: string | null, state: string): string {
  const account = organization === null ? "" : `organizations/${organization}/`;
  return `https://github.com/${account}settings/apps/new?state=${encodeURIComponent(state)}`;
}
