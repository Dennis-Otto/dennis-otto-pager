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

/** An issue or pull request that someone other than the maintainer opened. */
export interface Contribution extends Base {
  kind: "contribution";
  state: "new" | "drafting" | "draft" | "sent" | "ignored";
  number: number;
  pull: boolean;
  title: string;
  url: string;
  author: string;
  draft: string | null;
  /** Counts the drafts, so that "Send" posts the one that its message showed. */
  draftVersion: number;
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
}

/** A reminder of the pager itself, such as the token of Claude that expires. */
export interface Reminder extends Base {
  kind: "reminder";
  state: "open" | "done";
  text: string;
}

export type Item = Contribution | Alarm | Alert | Release | Reminder;
export type Kind = Item["kind"];

const CLOSED: ReadonlySet<string> = new Set([
  "sent",
  "ignored",
  "recovered",
  "resolved",
  "published",
  "done",
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

/** The key of each kind of thing: one thing per issue, and one bundle per repository. */
export const keys = {
  contribution: (repo: string, number: number) => `c:${repo}#${number}`,
  alarm: (repo: string) => `a:${repo}`,
  alert: (repo: string) => `s:${repo}`,
  release: (repo: string) => `r:${repo}`,
  reminder: (name: string) => `t:${name}`,
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
