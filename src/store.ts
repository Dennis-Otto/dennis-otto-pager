/**
 * The things that the pager shows, one message of Telegram each, in a topic of
 * their own where the chat has topics, and their state in Workers KV: as little as
 * possible, nothing secret, and a closed thing expires after 30 days.
 */
import type { ReleaseNotes } from "./content.ts";
import { sha256Hex } from "./crypto.ts";
import type { Severity } from "./rules.ts";
import type { Thread } from "./telegram.ts";
import type { Translation } from "./translations.ts";

/** One part of a bundle, such as a failed check on main or a code-scanning alert. */
export interface Entry {
  key: string;
  label: string;
  url: string;
  /** The run of GitHub Actions that failed, which 🔁 Rerun runs again, if the entry names one. */
  run?: number;
  /** 🔁 Rerun started its failed jobs again; the next failure or pass of the entry ends it. */
  rerun?: true;
  /**
   * The entry asks for an upload that only a person can make, that of the social
   * preview, which no API offers: 🛠 Start fix leaves it out.
   */
  upload?: true;
}

/**
 * A pause of new topics after Telegram refused one: until when the pager asks for
 * none, and how long the pause is, which the next refusal doubles (src/topics.ts).
 */
export interface TopicPause {
  /** In milliseconds since 1970. */
  until: number;
  /** In milliseconds. */
  length: number;
}

/** The topic of the chat that a thing has: its thread, and the name that it shows now. */
export interface Topic {
  thread: number;
  name: string;
}

interface Base {
  /** The short id in the data of the buttons, from the key of the thing. */
  id: string;
  repo: string;
  /** The installation of the GitHub App on the repository. */
  installation: number;
  /** The message of Telegram that shows the thing. */
  messageId: number | null;
  /** The last word of the control repository or of an action, shown below. */
  note: string | null;
  /** When "Later" brings it back, in milliseconds since 1970. */
  snoozedUntil: number | null;
  /**
   * The topic that holds everything about the thing, or null for the main view: a
   * chat without topics, a topic that Telegram refused, and a record from before
   * topics, which has none.
   */
  topic?: Topic | null;
  /**
   * When Telegram first refused to rename the topic to the thing's name, in
   * milliseconds since 1970: the schedule tries again for a day (src/schedule.ts).
   */
  renameRefused?: number;
  /**
   * When the thing went to the control repository, in milliseconds since 1970,
   * while it waits for the answer of that job: any answer ends the wait.
   */
  jobStarted?: number;
}

/** A discussion of GitHub, which a reply in its thread answers, as the app. */
export interface Discussion {
  /** The id of the discussion in the GraphQL API of GitHub. */
  node: string;
  /** The id of the comment whose thread the reply goes into; none for the discussion itself. */
  comment?: string;
  /**
   * Set when a comment came while the draft of an older one was still being
   * written: that draft is dropped when it comes, and the next one is asked for.
   */
  redraft?: boolean;
}

/**
 * The newest comment of someone else on an issue or a pull request, which the
 * reply answers. A reply to an issue or a pull request is a comment of its own, so
 * the comment is what the draft answers, not where the reply goes.
 */
export interface IssueComment {
  /** The id of the comment in the REST API of GitHub. */
  id: number;
  /**
   * When a comment last notified the maintainer, in milliseconds since 1970: the
   * comments that follow within QUIET of src/pager.ts edit the message alone.
   */
  noticed: number;
  /**
   * Set when a comment came while the draft of an older message was still being
   * written: that draft is dropped when it comes, and the next one is asked for.
   */
  redraft?: boolean;
}

/**
 * An issue, a pull request or a discussion that someone other than the maintainer
 * opened, or the newest comment of someone else on one. One that GitHub dealt
 * with itself, such as with a reply of the maintainer there, is done.
 */
export interface Contribution extends Base {
  kind: "contribution";
  state: "new" | "drafting" | "draft" | "sent" | "done" | "ignored";
  number: number;
  pull: boolean;
  title: string;
  /** The issue, the pull request, the discussion or the comment that the reply answers. */
  url: string;
  author: string;
  /**
   * The start of what the issue, the pull request, the discussion or the comment
   * that the reply answers says, as excerpt() of src/content.ts keeps it; none
   * when its text is empty.
   */
  excerpt?: string;
  draft: string | null;
  /** Counts the drafts, so that "Send" posts the one that its message showed. */
  draftVersion: number;
  /**
   * Set once the draft is the maintainer's own, written with ✏️ Edit: no draft of
   * the control repository replaces it, and a new comment on a discussion keeps it.
   */
  ownDraft?: true;
  /** The discussion of a contribution that is one; none for an issue or a pull request. */
  discussion?: Discussion;
  /** The newest comment of someone else on an issue or a pull request; none for a discussion. */
  comment?: IssueComment;
}

/**
 * What the reply of a contribution answers, which may wait for the draft of a newer
 * message: its discussion, or the newest comment on its issue or pull request.
 */
export function answering(
  item: Contribution,
): Discussion | IssueComment | undefined {
  return item.discussion ?? item.comment;
}

/** What fails on the default branch of a repository, bundled. */
export interface Alarm extends Base {
  kind: "alarm";
  state: "open" | "fixing" | "recovered" | "ignored";
  entries: Entry[];
}

/** A job of a run that failed, by its name and the address of its log. */
export interface Job {
  name: string;
  url: string;
}

/**
 * A workflow that fails on the default branch of a repository, any workflow but
 * those of a release, which the alarm has: one thing per workflow, which counts
 * the runs that failed since it last passed. The failure of a first attempt waits
 * for its rerun, as the bot of the checks of the blueprint makes one, unseen,
 * until WAIT of src/pager.ts is over: the schedule shows it then, unless a
 * rerun runs or passed.
 */
export interface Workflow extends Base {
  kind: "workflow";
  /** waiting: failed, not shown yet; rerunning: 🔁 Rerun ran its failed jobs again. */
  state: "waiting" | "failing" | "rerunning" | "recovered" | "ignored";
  /** The file of the workflow, such as .github/workflows/docs.yml, which keys the thing. */
  path: string;
  name: string;
  /** The default branch of the repository, which its runs ran on. */
  branch: string;
  /** The newest run of the workflow on the branch that the thing knows, failed or passed. */
  run: number;
  /** The newest attempt of that run that the thing knows. */
  attempt: number;
  /** The address of the attempt that failed last. */
  url: string;
  /** The jobs that failed in it, as many as the message names; none when they can't be read. */
  jobs: Job[];
  /** How many runs failed since the workflow last passed. */
  count: number;
  /** When the first of them failed, in milliseconds since 1970. */
  since: number;
  /** When the last of them failed. */
  last: number;
}

/**
 * What the security of a repository needs, bundled: the code-scanning alerts of
 * severity high or critical, and the open alerts of secret scanning.
 */
export interface Alert extends Base {
  kind: "alert";
  state: "open" | "fixing" | "resolved" | "ignored";
  entries: Entry[];
}

/** The release pull request of a repository. */
export interface Release extends Base {
  kind: "release";
  state: "ready" | "updating" | "merging" | "merged" | "published" | "ignored";
  number: number;
  version: string;
  sha: string;
  url: string;
  /** What the release brings, from the body of its pull request; none when the body has no notes. */
  notes?: ReleaseNotes;
  /** Its notes in the language of the pager, from the control repository (src/translations.ts). */
  translation?: Translation;
  /** The head of the pull request whose pictures of the visual check went into its topic. */
  album?: string;
}

/** A picture of the visual check that looks different, as its report names it. */
export interface Changed {
  /** Its path in the repository, such as screenshots/search.png. */
  path: string;
  status: "changed" | "new" | "deleted";
  /** The share of its pixels that changed, or null when its size changed, or it is new or deleted. */
  share: number | null;
}

/**
 * The pictures of a pull request of the maintainer or of a bot that look different
 * in its visual check, before and after, at its newest head that has any.
 */
export interface Pictures extends Base {
  kind: "pictures";
  state: "open" | "done" | "ignored";
  number: number;
  title: string;
  /** The pull request. */
  url: string;
  /** The head of the pull request that the message shows, whose album went. */
  sha: string;
  /** The pictures that look different, the largest change first, as many as the message lists. */
  changed: Changed[];
  /** How many pictures look different in all; none once the newest head looks as committed. */
  count: number;
  /** How many of them the album shows, with its difference, before and after. */
  shown: number;
  /**
   * How many of them the artifacts hold the difference of, each changed pixel in red;
   * none in a record from before the pager read the differences.
   */
  differences?: number;
  /** The run of the visual check, whose artifacts have every picture before and after. */
  check: string;
}

/**
 * A private vulnerability report of a repository, which SECURITY.md promises to
 * acknowledge within 7 days and to assess within 14. It is under embargo until it
 * is published: the pager keeps no word of what it says, only its id, its
 * severity and its day, so no summary reaches Telegram, a log or the control
 * repository.
 */
export interface Advisory extends Base {
  kind: "advisory";
  state: "open" | "published" | "done" | "ignored";
  /** The id of the advisory, such as GHSA-4f6x-8m2c-jq7p. */
  ghsa: string;
  url: string;
  severity: Severity | null;
  /** When it was reported, in milliseconds since 1970, from which SECURITY.md counts its days. */
  reported: number;
  /**
   * When the schedule looks whether it still waits in triage on GitHub, and
   * reminds once if it does; none once it looked, or when it came too late for that.
   */
  remindAt?: number;
}

/** A reminder of the pager itself, such as the token of Claude that expires. */
export interface Reminder extends Base {
  kind: "reminder";
  state: "open" | "done";
  text: string;
  /**
   * The token of GitHub that it names, GITHUB_USER_TOKEN of the Worker or
   * PAGER_FIX_TOKEN of the control repository; none for the token of Claude.
   */
  token?: "user" | "fix";
}

/**
 * A question of the maintainer's own agents, such as an orchestrator that runs
 * through the night, which the control repository forwards: its options are its
 * buttons, and the one pressed, or a text of the maintainer in its topic, is saved
 * in the control repository, where the agent reads it. The agent may take it back
 * while it is open. Its repository is the control repository.
 */
export interface Decision extends Base {
  kind: "decision";
  state: "open" | "answered" | "withdrawn";
  /** The id that the agent gave the question, which names its answer. */
  ask: string;
  question: string;
  /** Two to four options, in the order of their buttons. */
  options: string[];
  /** The place in options of the one that the maintainer chose, once answered. */
  choice: number | null;
  /** The answer in the maintainer's own words, a text in the topic instead of a button. */
  ownAnswer?: string;
}

/** The longest question of a decision, in characters, which its message shows whole. */
export const MAX_QUESTION = 1000;

/** The longest option of a decision, in characters, which its button shows whole. */
export const MAX_OPTION = 64;

/** The longest answer in the maintainer's own words, in characters, which its message shows whole. */
export const MAX_ANSWER = 1000;

export type Item =
  | Contribution
  | Alarm
  | Workflow
  | Alert
  | Advisory
  | Release
  | Pictures
  | Reminder
  | Decision;
export type Kind = Item["kind"];

const CLOSED: ReadonlySet<string> = new Set([
  "sent",
  "ignored",
  "recovered",
  "resolved",
  "published",
  "done",
  "answered",
  "withdrawn",
]);

/** The states in which a job of the control repository runs, and the one before. */
const RUNNING: Partial<Record<string, Item["state"]>> = {
  "contribution:drafting": "new",
  "alarm:fixing": "open",
  "alert:fixing": "open",
};

/** The state of a thing before the job of the control repository that runs for it, if one runs. */
export function beforeJob(item: Item): Item["state"] | undefined {
  return RUNNING[`${item.kind}:${item.state}`];
}

/** Whether a thing is done with, so that its record may expire. */
export function isClosed(item: Item): boolean {
  return CLOSED.has(item.state);
}

/** The id of the thing with this key: short enough for the data of a button. */
export async function itemId(key: string): Promise<string> {
  return `i${(await sha256Hex(key)).slice(0, 15)}`;
}

/**
 * The start of the key of an entry of an alarm for an event of GitHub that the
 * pager failed to handle, which src/deliveries.ts writes.
 */
export const DELIVERY_ENTRY = "delivery:";

/**
 * The start of the key of an entry of the security message of a repository for an
 * alert of secret scanning, whose numbers GitHub counts apart from code scanning.
 */
export const SECRET_ENTRY = "secret:";

/**
 * The key of each kind of thing: one thing per issue, pull request or discussion,
 * whose numbers GitHub counts together, one bundle per repository, one thing per
 * vulnerability report, one thing per workflow of a repository, the pictures of
 * one pull request, and one question of an agent per id.
 */
export const keys = {
  contribution: (repo: string, number: number) => `c:${repo}#${number}`,
  alarm: (repo: string) => `a:${repo}`,
  workflow: (repo: string, path: string) => `w:${repo}:${path}`,
  alert: (repo: string) => `s:${repo}`,
  advisory: (repo: string, ghsa: string) => `v:${repo}#${ghsa}`,
  release: (repo: string) => `r:${repo}`,
  pictures: (repo: string, number: number) => `p:${repo}#${number}`,
  reminder: (name: string) => `t:${name}`,
  decision: (ask: string) => `d:${ask}`,
  /** When an alert of secret scanning was resolved, a mark of its own, no thing. */
  secretResolved: (repo: string, number: number) => `x:${repo}#${number}`,
};

/**
 * How long the pager remembers that an alert of secret scanning was resolved, in
 * seconds: longer than the schedule asks for an event again (LOOK_BACK of
 * src/deliveries.ts), with the time that a redelivery takes.
 */
export const SECRET_MEMORY = 4 * 60 * 60;

const MONTH = 30 * 24 * 60 * 60;

/** The key of the pause of new topics, one for the chat. */
const TOPIC_PAUSE_KEY = "pause:topics";

/**
 * How long Workers KV keeps a pause of new topics, in seconds: a day, so that the
 * next refusal within it doubles the pause, and one after it starts short again.
 */
const TOPIC_PAUSE_MEMORY = 24 * 60 * 60;

/**
 * A text of the maintainer that waits for the answer of the control repository:
 * when it went, and the thread of the chat that it came from, where the answer goes.
 */
export interface Asked {
  since: number;
  thread: Thread;
  /** The schedule gave up on its answer: its 😢 came, and its thread stays for a late answer. */
  late?: true;
}

/** A text that the maintainer is writing in reply to a prompt of the pager. */
export interface PendingEdit {
  item: string;
  prompt: number;
}

/** What the schedule has to look at, from one list of the records. */
export interface Pending {
  /** The things whose "Later" is over. */
  due: string[];
  /** The things whose job of the control repository went before a time and didn't answer. */
  waiting: string[];
  /** The vulnerability reports whose reminder is due. */
  remind: string[];
  /** The things whose topic Telegram refused to rename. */
  rename: string[];
}

/** The metadata of the record of a thing, which the list reads. */
interface Marks {
  /** When its "Later" is over. */
  until?: number;
  /** When its job went to the control repository. */
  job?: number;
  /** When the reminder of a vulnerability report is due. */
  remind?: number;
  /** When Telegram first refused to rename its topic. */
  rename?: number;
}

/**
 * The labels that pagers up to 0.8.1 gave the entry of the issue of the bot-health
 * bot that asks for an upload of the social preview, before such an entry had its
 * mark, in English and in German: as a bot that fails up to 0.8.0, with the title
 * that the bot gives the issue (PREVIEW_TITLE of the blueprint's bot_health.py),
 * and by what to do in 0.8.1. Each comes from that one issue alone, and they stay
 * as those pagers wrote them, whatever the catalogs say now.
 */
const UPLOAD_LABELS: ReadonlySet<string> = new Set([
  "A bot fails: Upload the new social preview",
  "Ein Bot scheitert: Upload the new social preview",
  "🖼 Upload the new social preview",
  "🖼 Lade die neue Social Preview hoch",
]);

/**
 * A thing as the pager keeps it now. An entry of an alarm that asks for the upload
 * of the social preview, kept before such an entry had its mark, gets the mark by
 * its label, so that the alarm offers no 🛠 Start fix from its next read on; its
 * record keeps the mark from the next write of the thing, and a read alone writes
 * nothing.
 */
function current(item: Item): Item {
  if (item.kind === "alarm") {
    for (const entry of item.entries) {
      if (UPLOAD_LABELS.has(entry.label)) {
        entry.upload = true;
      }
    }
  }
  return item;
}

export class Store {
  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async get(id: string): Promise<Item | null> {
    const item = await this.kv.get<Item>(`item:${id}`, "json");
    return item === null ? null : current(item);
  }

  /**
   * Keep a thing, with one write: the time of its "Later", that of its job of the
   * control repository and that of the reminder of a vulnerability report go into
   * the metadata of its record, which the list of pending() reads without a read of
   * each record.
   */
  async put(item: Item): Promise<void> {
    const options: KVNamespacePutOptions = {};
    const marks: Marks = {};
    if (item.snoozedUntil !== null) {
      marks.until = item.snoozedUntil;
    }
    if (item.jobStarted !== undefined) {
      marks.job = item.jobStarted;
    }
    if (item.kind === "advisory" && item.remindAt !== undefined) {
      marks.remind = item.remindAt;
    }
    if (isClosed(item)) {
      options.expirationTtl = MONTH;
      // A done thing waits for nothing but the rename of its topic, with ✅.
      if (item.renameRefused !== undefined) {
        options.metadata = { rename: item.renameRefused };
      }
    } else {
      if (item.renameRefused !== undefined) {
        marks.rename = item.renameRefused;
      }
      if (Object.keys(marks).length > 0) {
        options.metadata = marks;
      }
    }
    await this.kv.put(`item:${item.id}`, JSON.stringify(item), options);
  }

  /**
   * The ids of the things whose "Later" is over at now, of those whose job of the
   * control repository went before jobsBefore, of the vulnerability reports
   * whose reminder is due at now, and of those whose topic Telegram refused to
   * rename, page by page of one list: the
   * free plan of KV allows a thousand lists a day, and the schedule runs 96 times.
   */
  async pending(
    now: number,
    jobsBefore: number,
    limit = 1000,
  ): Promise<Pending> {
    const pending: Pending = { due: [], waiting: [], remind: [], rename: [] };
    let cursor: string | null = null;
    do {
      const listed: KVNamespaceListResult<Marks> = await this.kv.list({
        prefix: "item:",
        limit,
        ...(cursor === null ? {} : { cursor }),
      });
      for (const key of listed.keys) {
        const id = key.name.slice("item:".length);
        const { until, job, remind, rename } = key.metadata ?? {};
        if (until !== undefined && until <= now) {
          pending.due.push(id);
        }
        if (job !== undefined && job < jobsBefore) {
          pending.waiting.push(id);
        }
        if (remind !== undefined && remind <= now) {
          pending.remind.push(id);
        }
        if (rename !== undefined) {
          pending.rename.push(id);
        }
      }
      cursor = listed.list_complete ? null : listed.cursor;
    } while (cursor !== null);
    return pending;
  }

  /**
   * The texts of the maintainer that went to the control repository and wait for
   * its answer: the id of each message, when it went and its thread. One record for
   * them all, which the schedule reads once per run, and a write only when one comes
   * or goes. A text kept before the pager knew threads has only its time, and its
   * answer goes into the main view, as it did then.
   */
  private async asked(): Promise<Record<string, Asked>> {
    const kept =
      (await this.kv.get<Record<string, number | Asked>>("asked", "json")) ??
      {};
    return Object.fromEntries(
      Object.entries(kept).map(([message, asked]) => [
        message,
        typeof asked === "number" ? { since: asked, thread: null } : asked,
      ]),
    );
  }

  /** Keep a text of the maintainer that waits for the answer of the control repository. */
  async ask(
    message: number,
    now: number,
    thread: Thread = null,
  ): Promise<void> {
    const asked = await this.asked();
    asked[message] = { since: now, thread };
    await this.kv.put("asked", JSON.stringify(asked));
  }

  /** The texts that wait for their answer since before a time, other than those given up on. */
  async waiting(before: number): Promise<number[]> {
    return Object.entries(await this.asked())
      .filter(([, asked]) => asked.late === undefined && asked.since < before)
      .map(([message]) => Number(message));
  }

  /**
   * Give up on the texts whose answer didn't come in time: they wait no longer, but
   * keep their thread for an answer that comes late, until they went before forget,
   * when the pager forgets them. A write only when one changes.
   */
  async giveUp(messages: number[], forget: number): Promise<void> {
    const asked = await this.asked();
    let changed = false;
    for (const [message, entry] of Object.entries(asked)) {
      if (entry.late !== undefined && entry.since < forget) {
        delete asked[message];
        changed = true;
      } else if (
        entry.late === undefined &&
        messages.includes(Number(message))
      ) {
        asked[message] = { ...entry, late: true };
        changed = true;
      }
    }
    if (changed) {
      await this.keepAsked(asked);
    }
  }

  /** Write the record of the texts that wait, or delete it when none is left. */
  private async keepAsked(asked: Record<string, Asked>): Promise<void> {
    if (Object.keys(asked).length === 0) {
      await this.kv.delete("asked");
    } else {
      await this.kv.put("asked", JSON.stringify(asked));
    }
  }

  /**
   * The thread that the answer to a text of the maintainer goes into: the one that
   * the text came from, also when its answer is late, or null for the main view.
   */
  async thread(message: number): Promise<Thread> {
    return (await this.asked())[message]?.thread ?? null;
  }

  /** Forget the texts that got their answer; a write only when one waited. */
  async settle(messages: number[]): Promise<void> {
    const asked = await this.asked();
    const left = Object.entries(asked).filter(
      ([message]) => !messages.includes(Number(message)),
    );
    if (left.length !== Object.keys(asked).length) {
      await this.keepAsked(Object.fromEntries(left));
    }
  }

  /**
   * Keep which thing a topic of the chat belongs to, so that a text in it goes with
   * that thing: one write when the topic opens and one when it is renamed. Once its
   * thing is done, the link expires after 30 days, as the record of a closed thing
   * does.
   */
  async link(thread: number, id: string, done: boolean): Promise<void> {
    await this.kv.put(
      `topic:${thread}`,
      id,
      done ? { expirationTtl: MONTH } : {},
    );
  }

  /**
   * The thing whose topic a thread is, or null: for a topic that the maintainer
   * opened, and for one whose thing is gone or has another topic now, such as the
   * release of a repository that moved on to its next version.
   */
  async byTopic(thread: number): Promise<Item | null> {
    const id = await this.kv.get(`topic:${thread}`);
    const item = id === null ? null : await this.get(id);
    return item?.topic?.thread === thread ? item : null;
  }

  /** The pause of new topics after Telegram refused one, or null when there is none. */
  async topicPause(): Promise<TopicPause | null> {
    return this.kv.get<TopicPause>(TOPIC_PAUSE_KEY, "json");
  }

  /** Pause new topics, after Telegram refused one. */
  async pauseTopics(pause: TopicPause): Promise<void> {
    await this.kv.put(TOPIC_PAUSE_KEY, JSON.stringify(pause), {
      expirationTtl: TOPIC_PAUSE_MEMORY,
    });
  }

  /** End the pause of new topics, once Telegram opened one again. */
  async resumeTopics(): Promise<void> {
    await this.kv.delete(TOPIC_PAUSE_KEY);
  }

  /** Remember when an alert of secret scanning was resolved: its number and that time, nothing else. */
  async resolveSecret(
    repo: string,
    number: number,
    time: number,
  ): Promise<void> {
    await this.kv.put(keys.secretResolved(repo, number), String(time), {
      expirationTtl: SECRET_MEMORY,
    });
  }

  /** When an alert of secret scanning was resolved, within SECRET_MEMORY, or null. */
  async secretResolvedAt(repo: string, number: number): Promise<number | null> {
    const kept = await this.kv.get(keys.secretResolved(repo, number));
    return kept === null ? null : Number(kept);
  }

  async pendingEdit(): Promise<PendingEdit | null> {
    return this.kv.get<PendingEdit>("edit", "json");
  }

  async setPendingEdit(edit: PendingEdit | null): Promise<void> {
    if (edit === null) {
      await this.kv.delete("edit");
    } else {
      await this.kv.put("edit", JSON.stringify(edit), { expirationTtl: 86400 });
    }
  }
}
