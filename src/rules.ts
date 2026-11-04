/**
 * What counts: the one place that decides which event of GitHub needs the
 * maintainer, and as what. Everything else of the pager acts on the signals that
 * these rules return, and docs/how-it-works.md lists the same rules in words.
 *
 * Everything that an issue or a pull request says is data: these rules read the
 * kind of an event, its author, its branch and its state, and pass titles on only
 * to be shown, escaped. What they hand on to be read, such as the label of an entry
 * or why a release may not merge, is a phrase of src/texts.ts without a language:
 * the pager words it in the language of its settings.
 */
import type { Phrase } from "./texts.ts";

/** The conclusions of a check or a workflow that count as a failure. */
export const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
/** The conclusions after which a failure counts as over. */
export const PASSED = new Set(["success", "neutral", "skipped"]);
/** The workflows of a release of the blueprint, whose failure is an alarm. */
export const RELEASE_WORKFLOWS = new Set([
  ".github/workflows/release.yml",
  ".github/workflows/build-release.yml",
  ".github/workflows/verify-release.yml",
]);
/** The label of the issues of the bot-health bot about a bot that fails on main. */
export const BOT_FAILURE = "bot-failure";
/** The severities of a code-scanning alert that page the maintainer. */
export const SEVERE = new Set(["high", "critical"]);
/** The branches of release-please, whose pull requests are releases. */
export const RELEASE_BRANCH = "release-please--";

interface Account {
  login?: string;
  type?: string;
}

/** The parts of a payload of GitHub that the rules read. */
export interface Payload {
  action?: string;
  installation?: { id?: number };
  repository?: {
    full_name?: string;
    default_branch?: string;
    owner?: Account;
  };
  sender?: Account;
  issue?: {
    number?: number;
    title?: string;
    html_url?: string;
    user?: Account;
    labels?: { name?: string }[];
    pull_request?: unknown;
  };
  pull_request?: {
    number?: number;
    title?: string;
    html_url?: string;
    user?: Account;
    merged?: boolean;
    head?: { ref?: string; sha?: string };
  };
  check_run?: {
    name?: string;
    conclusion?: string | null;
    html_url?: string;
    check_suite?: { head_branch?: string | null };
  };
  check_suite?: {
    head_branch?: string | null;
    pull_requests?: { number?: number }[];
  };
  workflow_run?: {
    name?: string;
    path?: string;
    event?: string;
    conclusion?: string | null;
    html_url?: string;
    head_branch?: string | null;
  };
  alert?: {
    number?: number;
    html_url?: string;
    rule?: {
      id?: string;
      description?: string;
      security_severity_level?: string | null;
    };
    most_recent_instance?: { ref?: string; location?: { path?: string } };
  };
  ref?: string;
  release?: { tag_name?: string; prerelease?: boolean };
}

interface Where {
  repo: string;
  installation: number;
}

export type Signal = Where &
  (
    | {
        type: "contribution";
        number: number;
        pull: boolean;
        title: string;
        url: string;
        author: string;
      }
    | { type: "failing"; key: string; label: Phrase; url: string }
    | { type: "recovered"; key: string }
    | {
        type: "check";
        name: string;
        failed: boolean;
        branch: string;
        url: string;
      }
    | { type: "release-check"; numbers: number[] }
    | { type: "release-updated"; number: number; sha: string }
    | { type: "release-merged"; number: number }
    | { type: "release-published"; tag: string }
    | { type: "alert-open"; key: string; label: Phrase; url: string }
    | { type: "alert-closed"; key: string }
  );

export type Outcome = { signal: Signal } | { ignored: string };

/** Whether an account is a bot: GitHub's type, or the suffix of an app's login. */
export function isBot(account: Account | undefined): boolean {
  return account?.type === "Bot" || (account?.login ?? "").endsWith("[bot]");
}

/** Whether an account is the maintainer, whose logins GitHub compares without case. */
export function isMaintainer(
  account: Account | undefined,
  maintainer: string,
): boolean {
  return (account?.login ?? "").toLowerCase() === maintainer.toLowerCase();
}

/** Whether a check, by its name, is one that the rules of the branch require. */
export function isRequired(name: string, required: readonly string[]): boolean {
  return required.includes(name);
}

/** The version of a release pull request by its title, such as "chore: release 1.2.3". */
export function releaseVersion(title: string): string | null {
  return /^chore(?:\([^)]*\))?: release (\S+)$/.exec(title)?.[1] ?? null;
}

/** The parts of a pull request that decide whether a release may merge. */
export interface PullRequestState {
  state?: string;
  title?: string;
  mergeable_state?: string;
  draft?: boolean;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
}

/**
 * Why a release pull request may not merge yet, or null when it may: it is open,
 * from a branch of release-please into the default branch, not a draft, and GitHub
 * calls it clean, so every required check passed and the branch is up to date.
 */
export function releaseBlocker(
  pull: PullRequestState,
  defaultBranch: string,
): Phrase | null {
  if (pull.state !== "open") {
    return { key: "blocker.closed" };
  }
  if (!(pull.head?.ref ?? "").startsWith(RELEASE_BRANCH)) {
    return { key: "blocker.branch" };
  }
  if (pull.base?.ref !== defaultBranch) {
    return { key: "blocker.base", values: { branch: defaultBranch } };
  }
  if (releaseVersion(pull.title ?? "") === null) {
    return { key: "blocker.title" };
  }
  if (pull.draft === true) {
    return { key: "blocker.draft" };
  }
  if (pull.mergeable_state !== "clean") {
    return {
      key: "blocker.checks",
      values: { state: pull.mergeable_state ?? "unknown" },
    };
  }
  return null;
}

function where(payload: Payload, maintainer: string): Where | string {
  const repo = payload.repository?.full_name;
  const installation = payload.installation?.id;
  if (repo === undefined || installation === undefined) {
    return "no repository or installation";
  }
  if (!isMaintainer(payload.repository?.owner, maintainer)) {
    return "a repository of another owner";
  }
  return { repo, installation };
}

function labels(payload: Payload): string[] {
  return (payload.issue?.labels ?? []).map((label) => label.name ?? "");
}

function issues(payload: Payload, at: Where, maintainer: string): Outcome {
  const issue = payload.issue;
  const number = issue?.number ?? 0;
  if (labels(payload).includes(BOT_FAILURE) && isBot(issue?.user)) {
    if (payload.action === "opened" || payload.action === "reopened") {
      return {
        signal: {
          ...at,
          type: "failing",
          key: `issue:${number}`,
          label: { key: "entry.bot", values: { title: issue?.title ?? "" } },
          url: issue?.html_url ?? "",
        },
      };
    }
    if (payload.action === "closed") {
      return { signal: { ...at, type: "recovered", key: `issue:${number}` } };
    }
    return { ignored: `the ${payload.action} of a bot-failure issue` };
  }
  if (payload.action !== "opened") {
    return { ignored: `an issue ${payload.action}` };
  }
  return contribution(at, issue, false, maintainer);
}

function contribution(
  at: Where,
  thing: Payload["issue"] | Payload["pull_request"],
  pull: boolean,
  maintainer: string,
): Outcome {
  const author = thing?.user;
  if (isMaintainer(author, maintainer)) {
    return { ignored: "opened by the maintainer" };
  }
  if (isBot(author)) {
    return { ignored: "opened by a bot" };
  }
  return {
    signal: {
      ...at,
      type: "contribution",
      number: thing?.number ?? 0,
      pull,
      title: thing?.title ?? "",
      url: thing?.html_url ?? "",
      author: author?.login ?? "",
    },
  };
}

function pullRequest(payload: Payload, at: Where, maintainer: string): Outcome {
  const pull = payload.pull_request;
  const number = pull?.number ?? 0;
  if ((pull?.head?.ref ?? "").startsWith(RELEASE_BRANCH)) {
    if (payload.action === "synchronize") {
      return {
        signal: {
          ...at,
          type: "release-updated",
          number,
          sha: pull?.head?.sha ?? "",
        },
      };
    }
    if (payload.action === "closed" && pull?.merged === true) {
      return { signal: { ...at, type: "release-merged", number } };
    }
    return { ignored: `a release pull request ${payload.action}` };
  }
  if (payload.action !== "opened") {
    return { ignored: `a pull request ${payload.action}` };
  }
  return contribution(at, pull, true, maintainer);
}

function checkRun(payload: Payload, at: Where): Outcome {
  const run = payload.check_run;
  const branch = run?.check_suite?.head_branch ?? "";
  if (payload.action !== "completed") {
    return { ignored: `a check run ${payload.action}` };
  }
  if (branch !== payload.repository?.default_branch) {
    return { ignored: "a check run of another branch" };
  }
  const conclusion = run?.conclusion ?? "";
  if (!FAILED.has(conclusion) && !PASSED.has(conclusion)) {
    return { ignored: `a check run that ended ${conclusion}` };
  }
  return {
    signal: {
      ...at,
      type: "check",
      name: run?.name ?? "",
      failed: FAILED.has(conclusion),
      branch,
      url: run?.html_url ?? "",
    },
  };
}

function checkSuite(payload: Payload, at: Where): Outcome {
  const suite = payload.check_suite;
  if (payload.action !== "completed") {
    return { ignored: `a check suite ${payload.action}` };
  }
  if (!(suite?.head_branch ?? "").startsWith(RELEASE_BRANCH)) {
    return { ignored: "a check suite of no release" };
  }
  const numbers = (suite?.pull_requests ?? []).flatMap((pull) =>
    pull.number === undefined ? [] : [pull.number],
  );
  if (numbers.length === 0) {
    return { ignored: "a check suite of no pull request" };
  }
  return { signal: { ...at, type: "release-check", numbers } };
}

function workflowRun(payload: Payload, at: Where): Outcome {
  const run = payload.workflow_run;
  const path = run?.path ?? "";
  if (payload.action !== "completed") {
    return { ignored: `a workflow run ${payload.action}` };
  }
  if (!RELEASE_WORKFLOWS.has(path) || run?.event === "pull_request") {
    return { ignored: "a workflow run of no release" };
  }
  const conclusion = run?.conclusion ?? "";
  const key = `workflow:${path}`;
  if (FAILED.has(conclusion)) {
    return {
      signal: {
        ...at,
        type: "failing",
        key,
        label: { key: "entry.release", values: { name: run?.name ?? path } },
        url: run?.html_url ?? "",
      },
    };
  }
  if (PASSED.has(conclusion)) {
    return { signal: { ...at, type: "recovered", key } };
  }
  return { ignored: `a release run that ended ${conclusion}` };
}

function codeScanning(payload: Payload, at: Where): Outcome {
  const alert = payload.alert;
  const key = `alert:${alert?.number ?? 0}`;
  const defaultRef = `refs/heads/${payload.repository?.default_branch ?? ""}`;
  const action = payload.action ?? "";
  // What a person does to an alert comes with an empty ref, as GitHub sends it: a
  // dismissal closes the alert on every branch, and a reopened one counts where
  // it was last seen.
  const ref = action.endsWith("_by_user")
    ? (alert?.most_recent_instance?.ref ?? defaultRef)
    : payload.ref;
  if (action !== "closed_by_user" && ref !== defaultRef) {
    return { ignored: "an alert of another branch" };
  }
  if (["fixed", "closed_by_user", "auto_dismissed"].includes(action)) {
    return { signal: { ...at, type: "alert-closed", key } };
  }
  if (!["created", "reopened", "reopened_by_user"].includes(action)) {
    return { ignored: `an alert ${action}` };
  }
  const severity = alert?.rule?.security_severity_level ?? "";
  if (!SEVERE.has(severity)) {
    return { ignored: `an alert of severity ${severity || "none"}` };
  }
  const path = alert?.most_recent_instance?.location?.path;
  const what = alert?.rule?.description ?? alert?.rule?.id ?? "";
  return {
    signal: {
      ...at,
      type: "alert-open",
      key,
      label:
        path === undefined
          ? { key: "entry.alert", values: { severity, what } }
          : { key: "entry.alertAt", values: { severity, what, path } },
      url: alert?.html_url ?? "",
    },
  };
}

function release(payload: Payload, at: Where): Outcome {
  const published = payload.release;
  if (payload.action !== "published" || published?.prerelease === true) {
    return { ignored: `a release ${payload.action}` };
  }
  return {
    signal: {
      ...at,
      type: "release-published",
      tag: published?.tag_name ?? "",
    },
  };
}

/** What an event of GitHub means for the maintainer: a signal, or why it means nothing. */
export function classify(
  event: string,
  payload: Payload,
  maintainer: string,
): Outcome {
  const at = where(payload, maintainer);
  if (typeof at === "string") {
    return { ignored: at };
  }
  switch (event) {
    case "issues":
      return issues(payload, at, maintainer);
    case "pull_request":
      return pullRequest(payload, at, maintainer);
    case "check_run":
      return checkRun(payload, at);
    case "check_suite":
      return checkSuite(payload, at);
    case "workflow_run":
      return workflowRun(payload, at);
    case "code_scanning_alert":
      return codeScanning(payload, at);
    case "release":
      return release(payload, at);
    default:
      return { ignored: `the event ${event}` };
  }
}
