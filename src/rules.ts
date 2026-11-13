/**
 * What counts: the one place that decides which event of GitHub needs the
 * maintainer, and as what. Everything else of the pager acts on the signals that
 * these rules return, and docs/how-it-works.md lists the same rules in words.
 *
 * Everything that an issue, a pull request or a discussion says is data: these
 * rules read the kind of an event, its author, its branch and its state, and pass
 * titles and the start of a text on only to be shown, escaped. What they hand on to be read, such as the label of an entry
 * or why a release may not merge, is a phrase of src/texts.ts without a language:
 * the pager words it in the language of its settings.
 */
import { excerpt } from "./content.ts";
import { SECRET_ENTRY } from "./store.ts";
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
/**
 * The visual check of a repository of the blueprint, whose artifact holds each
 * picture that looks different, before and after.
 */
export const VISUAL_WORKFLOW = ".github/workflows/visual.yml";
/** The label of the issues of the bot-health bot about a bot that fails on main. */
export const BOT_FAILURE = "bot-failure";
/**
 * The key in the marker of the one issue of the bot-health bot that fails nothing,
 * though it has the label bot-failure too: it asks for an upload of the social
 * preview, which no API offers (decision 0132 of the blueprint).
 */
export const SOCIAL_PREVIEW = "social-preview";
/** The severities of a code-scanning alert that page the maintainer. */
export const SEVERE = new Set(["high", "critical"]);
/** The severities that a reporter or the maintainer may give a vulnerability report. */
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
/**
 * The id of a security advisory of GitHub, such as GHSA-4f6x-8m2c-jq7p: four
 * letters and three groups of four, which nothing else can pass for.
 */
const GHSA = /^GHSA(?:-[0-9a-z]{4}){3}$/;
/**
 * The actions of secret scanning that put an alert into the security message of
 * its repository: found, found again, or found in public as well.
 */
const SECRET_OPENS: ReadonlySet<string> = new Set([
  "created",
  "reopened",
  "publicly_leaked",
]);
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
    body?: string | null;
    state?: string;
    html_url?: string;
    user?: Account;
    labels?: { name?: string }[];
    pull_request?: unknown;
    /** When the issue last changed, such as by the reopen of its event. */
    updated_at?: string;
  };
  pull_request?: {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    user?: Account;
    merged?: boolean;
    /** When the pull request last changed, such as by the push or the reopen of its event. */
    updated_at?: string;
    head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
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
    id?: unknown;
    name?: string;
    path?: string;
    event?: string;
    conclusion?: string | null;
    html_url?: string;
    head_branch?: string | null;
    head_sha?: string;
    run_attempt?: unknown;
    /** The repository whose code the run ran: another one for a pull request of a fork. */
    head_repository?: { full_name?: string } | null;
    /** The pull requests of the repository itself whose head the run ran on; none of a fork. */
    pull_requests?: { number?: number; head?: { sha?: string } }[];
  };
  /**
   * The alert of a code_scanning_alert or a secret_scanning_alert event. Secret
   * scanning names the kind of its secret; the rules read nothing else of it,
   * and never the secret, which its webhook doesn't carry.
   */
  alert?: {
    number?: number;
    html_url?: string;
    /** The kind of secret of an alert of secret scanning, such as mailchimp_api_key. */
    secret_type?: string;
    /** Its name in words, such as Mailchimp API Key. */
    secret_type_display_name?: string | null;
    /** How the alert of secret scanning was resolved; null while it is open. */
    resolution?: string | null;
    /** Whether secret scanning found the secret in public as well. */
    publicly_leaked?: boolean | null;
    /** When the alert of secret scanning was found, changed last, and resolved. */
    created_at?: string;
    updated_at?: string | null;
    resolved_at?: string | null;
    /** Whether the alert of code scanning is open, dismissed or fixed. */
    state?: string;
    rule?: {
      id?: string;
      description?: string;
      security_severity_level?: string | null;
    };
    most_recent_instance?: { ref?: string; location?: { path?: string } };
  };
  ref?: string;
  release?: { tag_name?: string; prerelease?: boolean; published_at?: string };
  /**
   * The security advisory of a repository_advisory event: a private vulnerability
   * report or a published advisory. Its summary and description are under embargo
   * until it is published: the rules read only its id, its severity and its day.
   */
  repository_advisory?: {
    ghsa_id?: string;
    severity?: string | null;
    created_at?: string | null;
  };
  discussion?: {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    /** The id of the discussion in the GraphQL API of GitHub, which a reply names. */
    node_id?: string;
    user?: Account;
    /** The address of the answer of a discussion of Q&A, once someone chose one. */
    answer_html_url?: string | null;
  };
  /** The comment of a discussion_comment, an issue_comment or a pull_request_review_comment event. */
  comment?: {
    /** The id of an issue comment, or of a review comment, in the REST API of GitHub. */
    id?: number;
    node_id?: string;
    html_url?: string;
    body?: string | null;
    user?: Account;
  };
  /** The review of a pull_request_review event. */
  review?: {
    /** The id of the review in the REST API of GitHub. */
    id?: number;
    html_url?: string;
    body?: string | null;
    user?: Account;
    /** What the review says of the pull request: commented, approved or changes_requested. */
    state?: string;
  };
}

/** The repository of an event and the installation of the app on it. */
export interface Where {
  repo: string;
  installation: number;
}

/**
 * What fails: an entry of the alarm, the run of GitHub Actions that it names, if
 * any, and whether it asks for an upload that only a person can make.
 */
interface Failure {
  key: string;
  label: Phrase;
  url: string;
  run?: number;
  upload?: true;
}

/** The start of what an issue, a pull request, a discussion or a comment says, if anything. */
interface Said {
  excerpt?: string;
}

/** The start of the text of a body, as a field of a signal: none when the body says nothing. */
function said(body: string | null | undefined): Said {
  const start = excerpt(body);
  return start === undefined ? {} : { excerpt: start };
}

export type Signal = Where &
  (
    | ({
        type: "contribution";
        number: number;
        pull: boolean;
        title: string;
        url: string;
        author: string;
      } & Said)
    | ({
        type: "discussion";
        number: number;
        title: string;
        /** The discussion, or the comment that the reply answers. */
        url: string;
        author: string;
        /** The id of the discussion in the GraphQL API of GitHub. */
        node: string;
        /** The id of the comment that the reply answers; none for the discussion itself. */
        comment?: string;
      } & Said)
    | {
        type: "discussion-done";
        number: number;
        /** Why it needs no reply of the pager any more, as GitHub saw it. */
        reason: DiscussionEnd;
      }
    | ({
        type: "comment";
        number: number;
        pull: boolean;
        title: string;
        /** The comment, which the reply answers. */
        url: string;
        author: string;
        /** The id of the comment in the REST API of GitHub, within its kind. */
        comment: number;
        /** A review or a comment in the code of a pull request; none for a comment of the conversation. */
        kind?: ReviewKind;
      } & Said)
    | ({
        type: "activity";
        number: number;
        pull: boolean;
        title: string;
        /** The issue or the pull request. */
        url: string;
        /** Who opened it, for a thing that the pager doesn't know yet. */
        author: string;
        /** Who did it. */
        by: string;
        what: Activity;
        /** When GitHub changed the issue or the pull request with it, which knows its event again; none when GitHub doesn't say. */
        changed?: string;
      } & Said)
    | {
        type: "contribution-done";
        number: number;
        /** Why it needs no reply of the pager any more, as GitHub saw it. */
        reason: ContributionEnd;
      }
    | ({ type: "failing" | "still-failing" } & Failure)
    | {
        type: "recovered";
        key: string;
        /**
         * The pass of a release workflow, which takes its entry out only when it
         * belongs to the failure: the run that passed, and whether a person
         * started it by hand, as a run that takes up a release that an earlier
         * run left as a draft.
         */
        release?: { run?: number; dispatched: boolean };
      }
    | {
        type: "check";
        name: string;
        failed: boolean;
        branch: string;
        url: string;
      }
    | {
        type: "workflow";
        /** The file of the workflow, such as .github/workflows/docs.yml, which keys its thing. */
        path: string;
        name: string;
        /** The default branch, which the run ran on. */
        branch: string;
        failed: boolean;
        /**
         * Set when the run was cancelled, by hand or by the concurrency group of its
         * workflow: neither a failure nor a pass, it ends only a rerun of 🔁 Rerun.
         */
        cancelled?: true;
        run: number;
        /** The attempt of the run that ended, from 1 on. */
        attempt: number;
        /** The address of that attempt. */
        url: string;
      }
    | {
        type: "health";
        /** The run that the issue of the bot-health bot names, which the pager reads; none when it names none. */
        run?: number;
        /** The default branch, which the bot looks at. */
        branch: string;
        /** What the issue becomes when its run can't be read: an entry of the alarm, as before. */
        fallback: { type: "failing" | "still-failing" } & Failure;
      }
    | { type: "release-check"; numbers: number[] }
    | { type: "release-updated"; number: number; sha: string }
    | { type: "release-merged"; number: number }
    | {
        type: "release-published";
        tag: string;
        /** When GitHub published it, in milliseconds since 1970, if GitHub says so. */
        published?: number;
      }
    | {
        type: "pictures";
        number: number;
        /** The head of the pull request that the visual check rendered. */
        sha: string;
        /** The run of the visual check, which keeps the pictures. */
        run: number;
      }
    | { type: "pull-closed"; number: number; merged: boolean }
    | { type: "alert-open"; key: string; label: Phrase; url: string }
    | {
        type: "secret-open";
        key: string;
        /** The number of the alert of secret scanning, whose first place the pager reads. */
        number: number;
        /** The kind of secret, in words; never the secret. */
        what: string;
        /** Whether secret scanning found it in public as well. */
        leaked: boolean;
        url: string;
        /** When the alert last changed, by the event, so that a late copy shows as such. */
        time: number | null;
      }
    | { type: "alert-closed"; key: string }
    | {
        type: "secret-closed";
        key: string;
        number: number;
        /** When the alert was resolved. */
        time: number | null;
      }
    | {
        type: "advisory";
        /** The id of the advisory, such as GHSA-4f6x-8m2c-jq7p. */
        ghsa: string;
        url: string;
        severity: Severity | null;
        /** When it was reported, in milliseconds since 1970, if GitHub says so. */
        reported: number | null;
      }
    | { type: "advisory-published"; ghsa: string }
  );

export type Outcome = { signal: Signal } | { ignored: string };

/**
 * How a discussion was dealt with on GitHub itself: the maintainer replied there,
 * someone chose an answer, or it was closed or deleted.
 */
export type DiscussionEnd = "replied" | "answered" | "closed" | "deleted";

/**
 * How an issue or a pull request of someone else was dealt with on GitHub itself:
 * the maintainer commented there, or it was closed, or merged.
 */
export type ContributionEnd = "replied" | "closed" | "merged";

/**
 * What a comment of someone else on a pull request is, besides one of its
 * conversation: a review, or a comment in its code, which is also a reply in the
 * thread of a review. Each has ids of its own, by the field of the draft that names
 * it, so ids compare only within a kind.
 */
export type ReviewKind = "review" | "reviewComment";

/**
 * What someone else did to an issue or a pull request of someone else after its
 * first message, without a word: new commits pushed, reopened, or a draft made
 * ready for review.
 */
export type Activity = "commits" | "reopened" | "ready";

/** The actions of an issues or a pull_request event that are an activity. */
const ACTIVITIES: ReadonlyMap<string, Activity> = new Map([
  ["synchronize", "commits"],
  ["reopened", "reopened"],
  ["ready_for_review", "ready"],
]);

/** The actions of a discussion event that end the wait for a reply. */
const DISCUSSION_ENDS: ReadonlySet<string> = new Set([
  "answered",
  "closed",
  "deleted",
]);

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

/** The parts of a pull request that decide whether a release may merge, or whose pictures count. */
export interface PullRequestState {
  state?: string;
  title?: string;
  mergeable_state?: string;
  draft?: boolean;
  user?: Account;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
  base?: { ref?: string; repo?: { full_name?: string } };
}

/**
 * Why the pictures of a visual check of a pull request don't count, or null when
 * they do: it is open, still at the head that the check rendered, from a branch of
 * the repository itself, and of the maintainer or of a bot. What someone else's
 * pull request renders is theirs, so it never reaches the chat.
 */
export function picturesBlocker(
  pull: PullRequestState,
  repo: string,
  sha: string,
  maintainer: string,
): string | null {
  if (pull.state !== "open") {
    return "it isn't open";
  }
  if (pull.head?.sha !== sha) {
    return "it moved on to another head";
  }
  if (pull.head?.repo?.full_name !== repo) {
    return "it comes from a fork";
  }
  if (!isMaintainer(pull.user, maintainer) && !isBot(pull.user)) {
    return "someone else opened it";
  }
  return null;
}

/**
 * Why a release pull request may not merge yet, or null when it may: it is open,
 * from a branch of release-please of the repository itself into the default branch,
 * not a draft, and GitHub calls it clean, so every required check passed and the
 * branch is up to date. A fork may name its branch like release-please, but what it
 * holds is someone else's code, never a release.
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
  if (pull.head?.repo?.full_name !== pull.base?.repo?.full_name) {
    return { key: "blocker.fork" };
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

/**
 * Whether the pager serves the repositories of an account: the maintainer's own,
 * and those of the further owners of OWNERS, such as an organization; GitHub
 * compares logins without case.
 */
export function isServed(
  account: Account | undefined,
  maintainer: string,
  owners: readonly string[],
): boolean {
  return [maintainer, ...owners].some((owner) => isMaintainer(account, owner));
}

/**
 * The repository and installation of an event, or why the pager doesn't serve it.
 * Whose repository it is decides only this; who counts as the maintainer stays
 * MAINTAINER_LOGIN alone, also in a repository of an organization.
 */
function where(
  payload: Payload,
  maintainer: string,
  owners: readonly string[],
): Where | string {
  const repo = payload.repository?.full_name;
  const installation = payload.installation?.id;
  if (repo === undefined || installation === undefined) {
    return "no repository or installation";
  }
  if (!isServed(payload.repository?.owner, maintainer, owners)) {
    return "a repository of another owner";
  }
  return { repo, installation };
}

/** The id of a run of GitHub Actions, or of a comment, when it is one: a positive whole number. */
function runId(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined;
}

/** The field of a run in a signal: none for a failure that names no run. */
function withRun(run: number | undefined): { run?: number } {
  return run === undefined ? {} : { run };
}

/**
 * The marker in which the bot-health bot keeps the state of its issue, as JSON. Its
 * JSON never holds " -->": the bot writes each "--" of it as "-\u002d", which
 * JSON.parse reads back as "--", so " -->" can only be the end of the marker.
 */
const HEALTH_START = "<!-- bot-health ";
const HEALTH_END = " -->";

/**
 * The state that an issue of the bot-health bot keeps in the marker of its body,
 * such as <!-- bot-health {"attempt": 1, "run": 3, ...} -->; undefined without a
 * marker whose JSON reads. Two searches for text, not a regular expression, so
 * that no body can make it slow.
 */
function healthState(body: string | null | undefined): unknown {
  const text = body ?? "";
  const start = text.indexOf(HEALTH_START);
  const end =
    start < 0 ? -1 : text.indexOf(HEALTH_END, start + HEALTH_START.length);
  if (end < 0) {
    return undefined;
  }
  try {
    return JSON.parse(text.slice(start + HEALTH_START.length, end));
  } catch {
    return undefined;
  }
}

/**
 * The run that an issue of the bot-health bot names: the newest that failed, which
 * the bot writes into the marker of its body at each failure.
 */
export function healthRun(body: string | null | undefined): number | undefined {
  return runId(
    (healthState(body) as { run?: unknown } | null | undefined)?.run,
  );
}

/**
 * Whether an issue of the bot-health bot is the one that asks for an upload of the
 * social preview, by the key social-preview in its marker: GitHub shows another
 * picture than the committed one, and only a person can upload it, so nothing fails.
 */
export function asksForUpload(body: string | null | undefined): boolean {
  return (
    (healthState(body) as { key?: unknown } | null | undefined)?.key ===
    SOCIAL_PREVIEW
  );
}

/** The job of a run of GitHub Actions, as the address of its check run names it. */
const ACTIONS_JOB =
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/(\d+)\/job\/\d+$/;

/** The run of GitHub Actions of a check run, by its address, if it is one. */
export function checkRunOf(url: string): number | undefined {
  const job = ACTIONS_JOB.exec(url);
  return job === null ? undefined : runId(Number(job[1]));
}

function labels(payload: Payload): string[] {
  return (payload.issue?.labels ?? []).map((label) => label.name ?? "");
}

function issues(payload: Payload, at: Where, maintainer: string): Outcome {
  const issue = payload.issue;
  const number = issue?.number ?? 0;
  if (labels(payload).includes(BOT_FAILURE) && isBot(issue?.user)) {
    const run = healthRun(issue?.body);
    const upload = asksForUpload(issue?.body);
    const failure: Failure = {
      key: `issue:${number}`,
      // The issue of the social preview fails nothing, so its entry says what to
      // do; it keeps the link of the issue, which holds the picture to save and the
      // way to the settings of the repository, where only a person can upload it,
      // and its mark keeps 🛠 Start fix away from it.
      label: upload
        ? { key: "entry.preview" }
        : { key: "entry.bot", values: { title: issue?.title ?? "" } },
      url: issue?.html_url ?? "",
      ...withRun(run),
      ...(upload ? { upload: true } : {}),
    };
    // Each new failure of its bot edits the open issue, with the run that failed
    // now. The pager reads that run and takes it as the event of its workflow,
    // whose thing knows it already when its event came: the issue pages only for
    // a failure that the pager missed, and only as an entry of the alarm when the
    // run can't be read.
    let type: "failing" | "still-failing" | null = null;
    if (payload.action === "opened" || payload.action === "reopened") {
      type = "failing";
    } else if (payload.action === "edited" && issue?.state === "open") {
      type = "still-failing";
    }
    if (type !== null) {
      return {
        signal: {
          ...at,
          type: "health",
          ...withRun(run),
          branch: payload.repository?.default_branch ?? "",
          fallback: { type, ...failure },
        },
      };
    }
    if (payload.action === "closed") {
      return { signal: { ...at, type: "recovered", key: `issue:${number}` } };
    }
    return { ignored: `the ${payload.action} of a bot-failure issue` };
  }
  // The end of an issue of someone else ends its thing.
  if (payload.action === "closed") {
    return isOwn(issue, maintainer)
      ? { ignored: "an issue of the maintainer or of a bot closed" }
      : contributionDone(at, number, "closed");
  }
  if (payload.action === "reopened") {
    return activity(payload, at, maintainer, issue, false, "reopened");
  }
  if (payload.action !== "opened") {
    return { ignored: `an issue ${payload.action}` };
  }
  return contribution(at, issue, false, maintainer);
}

/**
 * What someone else did to an issue or a pull request of someone else after its
 * first message, such as the fix that a contributor pushed after a review of the
 * maintainer, or an issue that its reporter reopened: an activity of its
 * contribution, which needs the maintainer again. The pushes and reopens of the
 * maintainer, and those of a bot, such as a branch brought up to date, mean
 * nothing, as does anything on an issue or a pull request of either.
 */
function activity(
  payload: Payload,
  at: Where,
  maintainer: string,
  thing: Payload["issue"] | Payload["pull_request"],
  pull: boolean,
  what: Activity,
): Outcome {
  const kind = pull ? "a pull request" : "an issue";
  if (isOwn(thing, maintainer)) {
    return {
      ignored: `${kind} of the maintainer or of a bot ${payload.action}`,
    };
  }
  const by = payload.sender;
  if (isMaintainer(by, maintainer) || isBot(by)) {
    return { ignored: `${kind} ${payload.action} by the maintainer or a bot` };
  }
  const changed = thing?.updated_at;
  return {
    signal: {
      ...at,
      type: "activity",
      number: thing?.number ?? 0,
      pull,
      title: thing?.title ?? "",
      url: thing?.html_url ?? "",
      author: thing?.user?.login ?? "",
      by: by?.login ?? "",
      what,
      ...(changed === undefined ? {} : { changed }),
      ...said(thing?.body),
    },
  };
}

/** Whether an issue or a pull request is one of the maintainer or of a bot, which makes no thing. */
function isOwn(
  thing: Payload["issue"] | Payload["pull_request"],
  maintainer: string,
): boolean {
  return isMaintainer(thing?.user, maintainer) || isBot(thing?.user);
}

/**
 * An issue or a pull request of someone else that GitHub dealt with: its thing
 * needs no reply of the pager any more.
 */
function contributionDone(
  at: Where,
  number: number,
  reason: ContributionEnd,
): Outcome {
  return { signal: { ...at, type: "contribution-done", number, reason } };
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
      ...said(thing?.body),
    },
  };
}

function pullRequest(payload: Payload, at: Where, maintainer: string): Outcome {
  const pull = payload.pull_request;
  const number = pull?.number ?? 0;
  // A release pull request comes from a branch of release-please of the repository
  // itself. A fork may name its branch like that, and one that runs release-please
  // gets such a branch by itself, but what it holds is someone else's code: its
  // pull request is a contribution like any other, which pages when it opens.
  if (
    (pull?.head?.ref ?? "").startsWith(RELEASE_BRANCH) &&
    pull?.head?.repo?.full_name === at.repo
  ) {
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
    // A new title or new notes, such as notes changed by hand before the merge:
    // the pager reads the pull request again, as when its checks finish.
    if (payload.action === "edited") {
      return { signal: { ...at, type: "release-check", numbers: [number] } };
    }
    return { ignored: `a release pull request ${payload.action}` };
  }
  // The end of a pull request of the maintainer or of a bot ends its pictures,
  // that of someone else its thing.
  if (payload.action === "closed") {
    return isOwn(pull, maintainer)
      ? {
          signal: {
            ...at,
            type: "pull-closed",
            number,
            merged: pull?.merged === true,
          },
        }
      : contributionDone(
          at,
          number,
          pull?.merged === true ? "merged" : "closed",
        );
  }
  const what = ACTIVITIES.get(payload.action ?? "");
  if (what !== undefined) {
    return activity(payload, at, maintainer, pull, true, what);
  }
  if (payload.action !== "opened") {
    return { ignored: `a pull request ${payload.action}` };
  }
  return contribution(at, pull, true, maintainer);
}

/**
 * A discussion, or a comment on one, that someone else wrote: a contribution whose
 * reply goes into its thread. A discussion of the maintainer stays theirs, comments
 * and all, since GitHub tells its author of each comment itself, and one of Q&A
 * whose answer was chosen needs no reply any more. A reply of the maintainer on
 * GitHub itself, a chosen answer, and a discussion closed or deleted end the wait
 * for a reply of the pager.
 */
function discussion(
  payload: Payload,
  at: Where,
  maintainer: string,
  comment: Payload["comment"] | null,
): Outcome {
  const found = payload.discussion;
  const what = comment === null ? "a discussion" : "a discussion comment";
  if (comment === null && DISCUSSION_ENDS.has(payload.action ?? "")) {
    return ended(at, found, maintainer, payload.action as DiscussionEnd);
  }
  if (payload.action !== "created") {
    return { ignored: `${what} ${payload.action}` };
  }
  const author = comment === null ? found?.user : comment?.user;
  if (isMaintainer(author, maintainer)) {
    // A discussion of the maintainer is theirs; their comment is a reply on GitHub.
    return comment === null
      ? { ignored: "written by the maintainer" }
      : ended(at, found, maintainer, "replied");
  }
  if (isBot(author)) {
    return { ignored: "written by a bot" };
  }
  if (isMaintainer(found?.user, maintainer)) {
    return { ignored: "a discussion of the maintainer" };
  }
  if (typeof found?.answer_html_url === "string") {
    return { ignored: "a discussion with an answer" };
  }
  const reply = comment?.node_id;
  return {
    signal: {
      ...at,
      type: "discussion",
      number: found?.number ?? 0,
      title: found?.title ?? "",
      url: (comment === null ? found?.html_url : comment?.html_url) ?? "",
      author: author?.login ?? "",
      node: found?.node_id ?? "",
      ...(reply === undefined ? {} : { comment: reply }),
      ...said(comment === null ? found?.body : comment?.body),
    },
  };
}

/**
 * A comment on an issue or a pull request of someone else, the thing of a
 * contribution: a comment of someone else is the newest message, which the reply
 * answers, and one of the maintainer is his reply on GitHub itself, which ends
 * the wait for one of the pager. An issue or a pull request of the maintainer or
 * of a bot stays theirs, comments and all, as a discussion of the maintainer does,
 * and a comment of a bot, such as one of the issue assistant, means nothing.
 */
function issueComment(
  payload: Payload,
  at: Where,
  maintainer: string,
): Outcome {
  const issue = payload.issue;
  if (payload.action !== "created") {
    return { ignored: `an issue comment ${payload.action}` };
  }
  return remark(at, maintainer, {
    thing: issue,
    pull: issue?.pull_request !== undefined,
    said: payload.comment,
  });
}

/**
 * A review of a pull request of someone else, the thing of a contribution, as
 * submitted: one of someone else is the newest message, as a comment is, and one
 * of the maintainer, such as his request for changes, is his reply on GitHub
 * itself. A review that says nothing but its comments in the code, as GitHub makes
 * one for each reply in the thread of a review comment, comes as those comments.
 */
function review(payload: Payload, at: Where, maintainer: string): Outcome {
  const found = payload.review;
  if (payload.action !== "submitted") {
    return { ignored: `a review ${payload.action}` };
  }
  return remark(at, maintainer, {
    thing: payload.pull_request,
    pull: true,
    said: found,
    kind: "review",
    // The webhook names the state in small letters, the REST API in capitals.
    silent:
      String(found?.state).toLowerCase() === "commented" &&
      excerpt(found?.body) === undefined,
  });
}

/**
 * A comment in the code of a pull request of someone else, also a reply in the
 * thread of a review comment, the usual place of an answer to a review: as a
 * comment of its conversation.
 */
function reviewComment(
  payload: Payload,
  at: Where,
  maintainer: string,
): Outcome {
  if (payload.action !== "created") {
    return { ignored: `a review comment ${payload.action}` };
  }
  return remark(at, maintainer, {
    thing: payload.pull_request,
    pull: true,
    said: payload.comment,
    kind: "reviewComment",
  });
}

/** What the ignored reason of a remark on a thing of the maintainer or of a bot calls it. */
const REMARKS = {
  issueComment: "a comment on an issue",
  review: "a review of a pull request",
  reviewComment: "a review comment on a pull request",
} as const satisfies Record<ReviewKind | "issueComment", string>;

/** A comment or a review, and the issue or the pull request that it is on. */
interface Remark {
  thing: Payload["issue"] | Payload["pull_request"];
  pull: boolean;
  said: Payload["comment"] | Payload["review"];
  /** A review or a comment in the code; none for a comment of the conversation. */
  kind?: ReviewKind;
  /** Set for a review that says nothing itself, whose comments come on their own. */
  silent?: boolean;
}

/**
 * A comment of someone else, or a review, on an issue or a pull request of
 * someone else: the newest message of its contribution, which the reply answers,
 * or, of the maintainer, his reply on GitHub itself.
 */
function remark(at: Where, maintainer: string, found: Remark): Outcome {
  const { thing, said: comment, kind } = found;
  if (isOwn(thing, maintainer)) {
    return {
      ignored: `${REMARKS[kind ?? "issueComment"]} of the maintainer or of a bot`,
    };
  }
  if (isBot(comment?.user)) {
    return { ignored: "written by a bot" };
  }
  const number = thing?.number ?? 0;
  if (isMaintainer(comment?.user, maintainer)) {
    return contributionDone(at, number, "replied");
  }
  if (found.silent === true) {
    return { ignored: "a review that says nothing but its comments" };
  }
  const id = runId(comment?.id);
  if (id === undefined) {
    return { ignored: "a comment without its id" };
  }
  return {
    signal: {
      ...at,
      type: "comment",
      number,
      pull: found.pull,
      title: thing?.title ?? "",
      url: comment?.html_url ?? "",
      author: comment?.user?.login ?? "",
      comment: id,
      ...(kind === undefined ? {} : { kind }),
      ...said(comment?.body),
    },
  };
}

/** A discussion that GitHub dealt with: its thing needs no reply of the pager any more. */
function ended(
  at: Where,
  found: Payload["discussion"],
  maintainer: string,
  reason: DiscussionEnd,
): Outcome {
  if (isMaintainer(found?.user, maintainer)) {
    return { ignored: "a discussion of the maintainer" };
  }
  return {
    signal: {
      ...at,
      type: "discussion-done",
      number: found?.number ?? 0,
      reason,
    },
  };
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
  const name = run?.name ?? "";
  // A job of GitHub Actions is a part of its workflow run, which pages as a thing
  // of its own, once a rerun can't help any more. Its pass still takes out an
  // entry of the alarm that the pager kept for it before it paged workflows.
  if (checkRunOf(run?.html_url ?? "") !== undefined) {
    return FAILED.has(conclusion)
      ? { ignored: "a job of a workflow, whose run pages" }
      : { signal: { ...at, type: "recovered", key: `check:${name}` } };
  }
  return {
    signal: {
      ...at,
      type: "check",
      name,
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

/**
 * The address of the attempt of a run that failed, such as
 * https://github.com/owner/repo/actions/runs/3/attempts/2, which GitHub shows as
 * that attempt. The jobs of a run without its attempt are those of its newest, a
 * rerun that may still run, which a fix would read in place of the failure.
 */
function attemptUrl(run: Payload["workflow_run"]): string {
  const url = run?.html_url ?? "";
  const attempt = run?.run_attempt;
  return url !== "" && Number.isSafeInteger(attempt) && (attempt as number) > 0
    ? `${url}/attempts/${attempt as number}`
    : url;
}

/**
 * A visual check that passed on a pull request of the repository itself, at its
 * head: its artifact may hold pictures that look different. Whose pull request it
 * is, and whether a picture changed, the pager asks GitHub then.
 */
function visualCheck(
  run: NonNullable<Payload["workflow_run"]>,
  at: Where,
): Outcome {
  if (run.conclusion !== "success") {
    return { ignored: `a visual check that ended ${run.conclusion}` };
  }
  const sha = run.head_sha ?? "";
  const pull = (run.pull_requests ?? []).find(
    (each) => sha !== "" && each.head?.sha === sha,
  );
  const id = runId(run.id);
  if (pull?.number === undefined || id === undefined) {
    return { ignored: "a visual check of no pull request of the repository" };
  }
  return {
    signal: {
      ...at,
      type: "pictures",
      number: pull.number,
      sha,
      run: id,
    },
  };
}

/** The events of the runs of a pull request, whose checks show on the pull request itself. */
const PULL_EVENTS: ReadonlySet<string> = new Set([
  "pull_request",
  "pull_request_target",
]);

/**
 * A run of any workflow but those of a release that failed, passed or was
 * cancelled on the default branch of the repository itself, such as one of a
 * push, of a schedule, of a bot or started by hand: a failure is a thing of its
 * workflow, which the pager shows once a rerun can't help any more, a pass may end
 * it, and a cancelled run ends a rerun of 🔁 Rerun without a result. A run of a
 * pull request, of another branch or of a fork, and one that was skipped, mean
 * nothing.
 */
function mainRun(
  run: Payload["workflow_run"],
  at: Where,
  branch: string,
): Outcome {
  if (PULL_EVENTS.has(run?.event ?? "")) {
    return { ignored: "a workflow run of a pull request" };
  }
  if (branch === "" || run?.head_branch !== branch) {
    return { ignored: "a workflow run of another branch" };
  }
  if ((run.head_repository?.full_name ?? at.repo) !== at.repo) {
    return { ignored: "a workflow run of a fork" };
  }
  const conclusion = run.conclusion ?? "";
  const failed = FAILED.has(conclusion);
  const cancelled = conclusion === "cancelled";
  if (!failed && !cancelled && conclusion !== "success") {
    return { ignored: `a workflow run that ended ${conclusion}` };
  }
  const id = runId(run.id);
  const path = run.path ?? "";
  if (id === undefined || path === "") {
    return { ignored: "a workflow run that names no run or no workflow" };
  }
  return {
    signal: {
      ...at,
      type: "workflow",
      path,
      name: run.name || path,
      branch,
      failed,
      ...(cancelled ? { cancelled } : {}),
      run: id,
      attempt: runId(run.run_attempt) ?? 1,
      url: attemptUrl(run),
    },
  };
}

function workflowRun(payload: Payload, at: Where): Outcome {
  if (payload.action !== "completed") {
    return { ignored: `a workflow run ${payload.action}` };
  }
  return finishedRun(
    payload.workflow_run,
    at,
    payload.repository?.default_branch ?? "",
  );
}

/**
 * What a run of GitHub Actions that ended means, on a repository with this
 * default branch: as the event of its end says, and as the pager reads the run
 * that an issue of the bot-health bot names.
 */
export function finishedRun(
  run: Payload["workflow_run"],
  at: Where,
  branch: string,
): Outcome {
  const path = run?.path ?? "";
  // A visual check outside a pull request is a workflow like any other.
  if (path === VISUAL_WORKFLOW && run?.event === "pull_request") {
    return visualCheck(run, at);
  }
  if (!RELEASE_WORKFLOWS.has(path) || PULL_EVENTS.has(run?.event ?? "")) {
    return mainRun(run, at, branch);
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
        url: attemptUrl(run),
        ...withRun(runId(run?.id)),
      },
    };
  }
  if (PASSED.has(conclusion)) {
    // A run of a push or of the schedule passes when it finds nothing to
    // release, also while the release of a run that failed is still a draft.
    return {
      signal: {
        ...at,
        type: "recovered",
        key,
        release: {
          ...withRun(runId(run?.id)),
          dispatched: run?.event === "workflow_dispatch",
        },
      },
    };
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
  // An alert that code scanning found first in a pull request was created on the
  // ref of that pull request; once it reaches the default branch, by the merge,
  // GitHub sends appeared_in_branch rather than a second created.
  if (
    !["created", "appeared_in_branch", "reopened", "reopened_by_user"].includes(
      action,
    )
  ) {
    return { ignored: `an alert ${action}` };
  }
  // A person's dismissal holds on every branch, also one the alert reaches later.
  if (alert?.state === "dismissed") {
    return { ignored: "a dismissed alert" };
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

/**
 * An alert of secret scanning, which comes on any branch: an entry of the security
 * message of its repository while it is open, named by the kind of its secret.
 */
function secretScanning(payload: Payload, at: Where): Outcome {
  const alert = payload.alert;
  const number = alert?.number ?? 0;
  const key = `${SECRET_ENTRY}${number}`;
  const action = payload.action ?? "";
  if (action === "resolved") {
    return {
      signal: {
        ...at,
        type: "secret-closed",
        key,
        number,
        time: timeOf(alert?.resolved_at) ?? timeOf(alert?.updated_at),
      },
    };
  }
  if (!SECRET_OPENS.has(action)) {
    return { ignored: `a secret alert ${action}` };
  }
  // GitHub also tells of a secret found in public whose alert was resolved, such
  // as one that was revoked: it needs nothing more.
  if ((alert?.resolution ?? null) !== null) {
    return { ignored: "a secret alert that was resolved" };
  }
  return {
    signal: {
      ...at,
      type: "secret-open",
      key,
      number,
      what: alert?.secret_type_display_name || (alert?.secret_type ?? ""),
      leaked: action === "publicly_leaked" || alert?.publicly_leaked === true,
      url: alert?.html_url ?? "",
      time: timeOf(alert?.updated_at) ?? timeOf(alert?.created_at),
    },
  };
}

/** A severity that GitHub knows, or null for none or any other. */
function severityOf(value: string | null | undefined): Severity | null {
  return SEVERITIES.find((each) => each === value) ?? null;
}

/** A time of GitHub in milliseconds since 1970, or null where it names none. */
function timeOf(value: string | null | undefined): number | null {
  const time = Date.parse(value ?? "");
  return Number.isNaN(time) ? null : time;
}

/**
 * A private vulnerability report, and the advisory that GitHub publishes: the
 * report is a thing of its own, under embargo, and its publication ticks it.
 */
function advisory(payload: Payload, at: Where): Outcome {
  const report = payload.repository_advisory;
  const ghsa = report?.ghsa_id ?? "";
  if (!GHSA.test(ghsa)) {
    return { ignored: "an advisory without its id" };
  }
  if (payload.action === "published") {
    return { signal: { ...at, type: "advisory-published", ghsa } };
  }
  if (payload.action !== "reported") {
    return { ignored: `an advisory ${payload.action}` };
  }
  return {
    signal: {
      ...at,
      type: "advisory",
      ghsa,
      url: `https://github.com/${at.repo}/security/advisories/${ghsa}`,
      severity: severityOf(report?.severity),
      reported: timeOf(report?.created_at),
    },
  };
}

function release(payload: Payload, at: Where): Outcome {
  const published = payload.release;
  if (payload.action !== "published" || published?.prerelease === true) {
    return { ignored: `a release ${payload.action}` };
  }
  const time = timeOf(published?.published_at);
  return {
    signal: {
      ...at,
      type: "release-published",
      tag: published?.tag_name ?? "",
      ...(time === null ? {} : { published: time }),
    },
  };
}

/**
 * What an event of GitHub means for the maintainer: a signal, or why it means
 * nothing. The pager serves the repositories of the maintainer and of the further
 * owners of OWNERS, none by default.
 */
export function classify(
  event: string,
  payload: Payload,
  maintainer: string,
  owners: readonly string[] = [],
): Outcome {
  const at = where(payload, maintainer, owners);
  if (typeof at === "string") {
    return { ignored: at };
  }
  switch (event) {
    case "issues":
      return issues(payload, at, maintainer);
    case "pull_request":
      return pullRequest(payload, at, maintainer);
    case "discussion":
      return discussion(payload, at, maintainer, null);
    case "discussion_comment":
      return discussion(payload, at, maintainer, payload.comment);
    case "issue_comment":
      return issueComment(payload, at, maintainer);
    case "pull_request_review":
      return review(payload, at, maintainer);
    case "pull_request_review_comment":
      return reviewComment(payload, at, maintainer);
    case "check_run":
      return checkRun(payload, at);
    case "check_suite":
      return checkSuite(payload, at);
    case "workflow_run":
      return workflowRun(payload, at);
    case "code_scanning_alert":
      return codeScanning(payload, at);
    case "secret_scanning_alert":
      return secretScanning(payload, at);
    case "repository_advisory":
      return advisory(payload, at);
    case "release":
      return release(payload, at);
    default:
      return { ignored: `the event ${event}` };
  }
}
