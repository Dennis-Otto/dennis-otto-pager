/**
 * The things that the pager shows, one message of Telegram each, in a topic of
 * their own where the chat has topics, and their state in Workers KV: as little as
 * possible, nothing secret, and a closed thing expires after 30 days.
 */
import { sha256Hex } from "./crypto.ts";
import type { Thread } from "./telegram.ts";

/** One part of a bundle, such as a failed check on main or a code-scanning alert. */
export interface Entry {
  key: string;
  label: string;
  url: string;
  /** The run of GitHub Actions that failed, which 🔁 Rerun runs again, if the entry names one. */
  run?: number;
  /** 🔁 Rerun started its failed jobs again; the next failure or pass of the entry ends it. */
  rerun?: true;
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
 * An issue, a pull request or a discussion that someone other than the maintainer
 * opened, or the newest comment of someone else on a discussion. A discussion that
 * GitHub dealt with itself, such as with a reply of the maintainer there, is done.
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
}

/** What fails on the default branch of a repository, bundled. */
export interface Alarm extends Base {
  kind: "alarm";
  state: "open" | "fixing" | "recovered" | "ignored";
  entries: Entry[];
}

/** The code-scanning alerts of severity high or critical of a repository, bundled. */
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
  /** How many of them the album shows, before and after. */
  shown: number;
  /** The run of the visual check, whose artifacts have every picture before and after. */
  check: string;
}

/** A reminder of the pager itself, such as the token of Claude that expires. */
export interface Reminder extends Base {
  kind: "reminder";
  state: "open" | "done";
  text: string;
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
  | Alert
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
 * The key of each kind of thing: one thing per issue, pull request or discussion,
 * whose numbers GitHub counts together, one bundle per repository, the
 * pictures of one pull request, and one question of an agent per id.
 */
export const keys = {
  contribution: (repo: string, number: number) => `c:${repo}#${number}`,
  alarm: (repo: string) => `a:${repo}`,
  alert: (repo: string) => `s:${repo}`,
  release: (repo: string) => `r:${repo}`,
  pictures: (repo: string, number: number) => `p:${repo}#${number}`,
  reminder: (name: string) => `t:${name}`,
  decision: (ask: string) => `d:${ask}`,
};

const MONTH = 30 * 24 * 60 * 60;

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
}

/** The metadata of the record of a thing, which the list reads. */
interface Marks {
  /** When its "Later" is over. */
  until?: number;
  /** When its job went to the control repository. */
  job?: number;
}

export class Store {
  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async get(id: string): Promise<Item | null> {
    return this.kv.get<Item>(`item:${id}`, "json");
  }

  /**
   * Keep a thing, with one write: the time of its "Later" and that of its job of
   * the control repository go into the metadata of its record, which the list of
   * pending() reads without a read of each record.
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
    if (isClosed(item)) {
      options.expirationTtl = MONTH;
    } else if (Object.keys(marks).length > 0) {
      options.metadata = marks;
    }
    await this.kv.put(`item:${item.id}`, JSON.stringify(item), options);
  }

  /**
   * The ids of the things whose "Later" is over at now, and of those whose job of
   * the control repository went before jobsBefore, page by page of one list: the
   * free plan of KV allows a thousand lists a day, and the schedule runs 96 times.
   */
  async pending(
    now: number,
    jobsBefore: number,
    limit = 1000,
  ): Promise<Pending> {
    const pending: Pending = { due: [], waiting: [] };
    let cursor: string | null = null;
    do {
      const listed: KVNamespaceListResult<Marks> = await this.kv.list({
        prefix: "item:",
        limit,
        ...(cursor === null ? {} : { cursor }),
      });
      for (const key of listed.keys) {
        const id = key.name.slice("item:".length);
        const { until, job } = key.metadata ?? {};
        if (until !== undefined && until <= now) {
          pending.due.push(id);
        }
        if (job !== undefined && job < jobsBefore) {
          pending.waiting.push(id);
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
