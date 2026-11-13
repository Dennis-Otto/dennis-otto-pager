/**
 * The version of the pager, and whether the Worker that runs is the latest release
 * of the pager's own repository. Workers Builds deploys a release outside GitHub,
 * so a build that passes without deploying, as a version without traffic, or one
 * that never starts, such as after a rename of the repository, shows nowhere: the
 * release on GitHub says that a change is out while the Worker before it keeps
 * serving. The pager hears of each release of its own repository, as of any
 * repository where its app is installed, notes it in the storage of the Durable
 * Object, and the schedule tells the maintainer once when the Worker still runs an
 * older version DEPLOY_WITHIN after it. A Worker of that release or a newer one
 * takes the note back. The health of the pager (src/health.ts) names the version
 * and the release that it waits for.
 */
import { repository, version } from "../package.json";
import type { Context } from "./pager.ts";

/**
 * The version of the code that runs, from package.json, which the release raises
 * in the commit that Workers Builds deploys.
 */
export const VERSION: string = version;

/**
 * How long a release may take to go live after GitHub published it, in
 * milliseconds: a build of Workers Builds takes a few minutes, and the rest is for
 * its queue. With the schedule every 15 minutes, the message comes between 30 and
 * 45 minutes after the release.
 */
export const DEPLOY_WITHIN = 30 * 60_000;

/** The key of the release that the Worker waits for, in the storage of the Durable Object. */
export const RELEASED = "release";

/** A release of the pager's own repository that the Worker doesn't run yet. */
export interface Released {
  /** Its version, such as 1.2.3. */
  version: string;
  /** When GitHub published it, or else when the pager heard of it, in milliseconds since 1970. */
  at: number;
  /** Whether the maintainer was told that it didn't go live, which he is once. */
  told?: true;
}

/**
 * The repository on GitHub that a URL of package.json names, such as
 * Dennis-Otto/repo-pager for git+https://github.com/Dennis-Otto/repo-pager.git, or
 * null for another host.
 */
export function repositoryOf(url: string): string | null {
  const match =
    /^(?:git\+)?https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(
      url,
    );
  return match?.[1] ?? null;
}

/** The pager's own repository, whose releases are those of the Worker. */
export const OWN: string | null = repositoryOf(repository.url);

/** The numbers of a version, such as [1, 2, 3] for v1.2.3; null for a prerelease or no version. */
function numbersOf(tag: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  return match === null ? null : match.slice(1).map(Number);
}

/** Whether the version that runs is older than the one released. */
export function isBehind(running: string, released: string): boolean {
  const ran = numbersOf(running);
  const out = numbersOf(released);
  if (ran === null || out === null) {
    return false;
  }
  const at = ran.findIndex((part, index) => part !== out[index]);
  return at !== -1 && (ran[at] as number) < (out[at] as number);
}

/**
 * Note a release that GitHub published, when it is one of the pager's own
 * repository that is newer than the Worker that runs: the schedule then looks
 * whether it went live. Returns whether it noted the release.
 */
export async function noteRelease(
  context: Context,
  repo: string,
  tag: string,
  published?: number,
  own: string | null = OWN,
): Promise<boolean> {
  if (own === null || repo.toLowerCase() !== own.toLowerCase()) {
    return false;
  }
  const released = tag.replace(/^v/, "");
  // An event that GitHub delivers again keeps the time of the first, and the
  // message that the maintainer had.
  if (
    !isBehind(VERSION, released) ||
    (await noted(context))?.version === released
  ) {
    return false;
  }
  await context.local.put<Released>(RELEASED, {
    version: released,
    // The time of GitHub, so that a delivery that the schedule retries later
    // still counts from when the release came out.
    at: published ?? context.now(),
  });
  return true;
}

async function noted(context: Context): Promise<Released | null> {
  return (await context.local.get<Released | null>(RELEASED)) ?? null;
}

/**
 * The release that the Worker waits for, or null when it runs the latest release
 * that it heard of.
 */
export async function awaited(context: Context): Promise<Released | null> {
  const released = await noted(context);
  return released !== null && isBehind(VERSION, released.version)
    ? released
    : null;
}

/**
 * Tell the maintainer once when a release of the pager didn't go live
 * DEPLOY_WITHIN after GitHub published it, as a message of its own that notifies.
 * A Worker that runs that release or a newer one takes the note back.
 */
export async function checkDeployed(context: Context): Promise<void> {
  const released = await noted(context);
  if (released === null) {
    return;
  }
  if (!isBehind(VERSION, released.version)) {
    await context.local.put<Released | null>(RELEASED, null);
    return;
  }
  if (released.told === true || context.now() - released.at < DEPLOY_WITHIN) {
    return;
  }
  const { t } = context;
  await context.telegram.send(
    t("deploy.behind", {
      version: VERSION,
      release: released.version,
      time: t.time(released.at),
    }),
    [],
  );
  await context.local.put<Released>(RELEASED, { ...released, told: true });
}
