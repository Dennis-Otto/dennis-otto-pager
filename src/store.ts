/**
 * The things that the pager shows, one message of Telegram each, and their state in
 * Workers KV: as little as possible, nothing secret, and a closed thing expires
 * after 30 days.
 */
import { sha256Hex } from "./crypto.ts";

/** One part of a bundle, such as a failed check on main or a code-scanning alert. */
export interface Entry {
  key: string;
  label: string;
  url: string;
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

/** A text that the maintainer is writing in reply to a prompt of the pager. */
export interface PendingEdit {
  item: string;
  prompt: number;
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
   * Keep a thing, with one write: the time of its "Later" goes into the metadata of
   * its record, which the list of due() reads without a read of each record.
   */
  async put(item: Item): Promise<void> {
    const options: KVNamespacePutOptions = {};
    if (isClosed(item)) {
      options.expirationTtl = MONTH;
    } else if (item.snoozedUntil !== null) {
      options.metadata = { until: item.snoozedUntil };
    }
    await this.kv.put(`item:${item.id}`, JSON.stringify(item), options);
  }

  /** The ids of the things whose "Later" is over at now, page by page of the list. */
  async due(now: number, limit = 1000): Promise<string[]> {
    const due: string[] = [];
    let cursor: string | null = null;
    do {
      const listed: KVNamespaceListResult<{ until?: number }> =
        await this.kv.list({
          prefix: "item:",
          limit,
          ...(cursor === null ? {} : { cursor }),
        });
      for (const key of listed.keys) {
        const until = key.metadata?.until;
        if (until !== undefined && until <= now) {
          due.push(key.name.slice("item:".length));
        }
      }
      cursor = listed.list_complete ? null : listed.cursor;
    } while (cursor !== null);
    return due;
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
