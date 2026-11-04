/**
 * The topics of the chat: one per thing, so that everything about it stays together.
 * The first message of a thing opens its topic, named after its repository and what
 * it is; its later messages, a draft, the prompt of an edit and the answers to a
 * text written in the topic go into it. A done thing gets ✅ in front of the name of
 * its topic, which stays as its history: the maintainer deletes one by hand. A chat
 * without topics, or a topic that Telegram refuses, keeps the thing in the main view,
 * as before topics.
 */
import type { Context } from "./pager.ts";
import { plain, render } from "./render.ts";
import { type Item, isClosed, type Kind, type Topic } from "./store.ts";
import { type Keyboard, TOPIC_COLORS, type TopicColor } from "./telegram.ts";
import type { Texts } from "./texts.ts";

/** The longest name of a topic that Telegram takes, in characters of UTF-16. */
export const MAX_TOPIC_NAME = 128;

/** The color of the icon of each kind of thing's topic. */
const COLORS: Readonly<Record<Kind, TopicColor>> = {
  contribution: TOPIC_COLORS.blue,
  alarm: TOPIC_COLORS.red,
  alert: TOPIC_COLORS.yellow,
  release: TOPIC_COLORS.green,
  reminder: TOPIC_COLORS.violet,
};

/**
 * Whether a thing is done, as the name of its topic shows: closed, or a release
 * that is merged, whose publishing is left to its workflow.
 */
export function isDone(item: Item): boolean {
  return isClosed(item) || (item.kind === "release" && item.state === "merged");
}

/** A text of at most max characters of UTF-16, cut between two characters, with … at the end. */
export function cut(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  let kept = "";
  for (const character of text) {
    if (kept.length + character.length > max - 1) {
      break;
    }
    kept += character;
  }
  return `${kept}…`;
}

/** What a thing is, as the name of its topic says it, with its repository without the owner. */
function what(item: Item, t: Texts): string {
  const repo = item.repo.slice(item.repo.indexOf("/") + 1);
  switch (item.kind) {
    case "contribution":
      return t("topic.contribution", {
        repo,
        number: item.number,
        title: item.title.replace(/\s+/g, " ").trim(),
      });
    case "alarm":
      return t("topic.alarm", { repo });
    case "alert":
      return t("topic.alert", { repo });
    case "release":
      return t("topic.release", { repo, version: item.version });
    case "reminder":
      return t("topic.reminder");
  }
}

/**
 * The name of a thing's topic, such as "🚨 repo-blueprint needs you": short, plain
 * text, and with ✅ in front once the thing is done.
 */
export function topicName(item: Item, t: Texts): string {
  const name = what(item, t);
  return cut(isDone(item) ? t("topic.done", { name }) : name, MAX_TOPIC_NAME);
}

/**
 * Send a new message of a thing: into its topic, which its first message opens, or
 * into the main view when the chat has no topics, Telegram refuses one, or the topic
 * is gone. A topic that the pager opened for this message and that took none is
 * deleted again, so that no empty topic stays. Returns the id of the message.
 */
export async function sendThing(
  context: Context,
  item: Item,
  text: string,
  buttons: Keyboard,
): Promise<number> {
  let topic: Topic | null = item.topic ?? null;
  let opened = false;
  if (topic === null && item.messageId === null) {
    const name = topicName(item, context.t);
    const thread = await context.telegram.openTopic(name, COLORS[item.kind]);
    if (thread !== null) {
      topic = { thread, name };
      opened = true;
    }
  }
  const sent = await context.telegram.post(
    text,
    buttons,
    topic?.thread ?? null,
  );
  if (topic !== null && sent.thread === null) {
    if (opened) {
      await context.telegram.removeTopic(topic.thread);
    }
    topic = null;
  } else if (topic !== null && opened) {
    await context.store.link(topic.thread, item.id, isDone(item));
  }
  item.topic = topic;
  return sent.message;
}

/**
 * Rename a thing's topic when its name changed: ✅ once it is done, without it when
 * a bundle opens again, and the new version of a release. A rename that Telegram
 * refuses keeps the old name, and the next change of the thing tries again.
 */
export async function retitle(context: Context, item: Item): Promise<void> {
  const topic = item.topic ?? null;
  if (topic === null) {
    return;
  }
  const name = topicName(item, context.t);
  if (name === topic.name) {
    return;
  }
  if (await context.telegram.renameTopic(topic.thread, name)) {
    item.topic = { thread: topic.thread, name };
    await context.store.link(topic.thread, item.id, isDone(item));
  }
}

/** The most characters of the message of a thing that go along with a text in its topic. */
export const MAX_ABOUT = 1500;

/** The most links of a thing that go along with a text in its topic: a page and 20 entries. */
export const MAX_LINKS = 21;

/**
 * A thing as a text written in its topic tells the control repository about it,
 * which reads it as data: the item that the text is about.
 */
export interface About {
  id: string;
  kind: Kind;
  repo: string;
  state: Item["state"];
  /** The number of the issue or pull request of a contribution or a release. */
  number?: number;
  /** The version of a release. */
  version?: string;
  /** Where GitHub shows it: the issue or pull request, or the pages of a bundle and each entry. */
  links: string[];
  /** Its message as the maintainer sees it, without HTML. */
  text: string;
}

/** What a text in the topic of a thing tells the control repository about the thing. */
export function about(item: Item, now: number, t: Texts): About {
  const links: string[] = [];
  const named: Pick<About, "number" | "version"> = {};
  switch (item.kind) {
    case "contribution":
      links.push(item.url);
      named.number = item.number;
      break;
    case "release":
      links.push(item.url);
      named.number = item.number;
      named.version = item.version;
      break;
    case "alarm":
    case "alert":
      links.push(
        item.kind === "alarm"
          ? `https://github.com/${item.repo}/actions`
          : `https://github.com/${item.repo}/security/code-scanning`,
        ...item.entries.map((entry) => entry.url),
      );
      break;
    default:
      break;
  }
  return {
    id: item.id,
    kind: item.kind,
    repo: item.repo,
    state: item.state,
    ...named,
    links: links
      .filter((url) => url.startsWith("https://github.com/"))
      .slice(0, MAX_LINKS),
    text: cut(plain(render(item, now, t)), MAX_ABOUT),
  };
}
