/**
 * The topics of the chat: one per thing, so that everything about it stays together.
 * The first message of a thing opens its topic, named after its repository and what
 * it is; its later messages, a draft, the prompt of an edit and the answers to a
 * text written in the topic go into it. A done thing gets ✅ in front of the name of
 * its topic, which stays as its history: the maintainer deletes one by hand when he
 * is done with it, and the next message of the thing opens a new topic. A chat
 * without topics, or a topic that Telegram refuses, keeps the thing in the main view,
 * as before topics.
 */
import { keyboard } from "./buttons.ts";
import { cut } from "./content.ts";
import type { Context } from "./pager.ts";
import { render, securityPage } from "./render.ts";
import { type Item, isClosed, type Kind, type Topic } from "./store.ts";
import {
  type Keyboard,
  type Sent,
  TOPIC_COLORS,
  type TopicColor,
} from "./telegram.ts";
import type { Texts } from "./texts.ts";

/** The longest name of a topic that Telegram takes, in characters of UTF-16. */
export const MAX_TOPIC_NAME = 128;

/** The color of the icon of each kind of thing's topic. */
const COLORS: Readonly<Record<Kind, TopicColor>> = {
  contribution: TOPIC_COLORS.blue,
  alarm: TOPIC_COLORS.red,
  workflow: TOPIC_COLORS.red,
  alert: TOPIC_COLORS.yellow,
  advisory: TOPIC_COLORS.red,
  release: TOPIC_COLORS.green,
  pictures: TOPIC_COLORS.rose,
  reminder: TOPIC_COLORS.violet,
  decision: TOPIC_COLORS.violet,
};

/** The color of the topic of a report of a run, which is no thing: what came out. */
export const REPORT_COLOR = TOPIC_COLORS.green;

/** The name of the topic of a reminder, by the token that it names (src/tokens.ts). */
const REMINDER_TOPICS = {
  claude: "topic.reminder",
  user: "topic.reminderUser",
  fix: "topic.reminderFix",
} as const;

/**
 * Whether a thing is done, as the name of its topic shows: closed, or a release
 * that is merged, whose publishing is left to its workflow.
 */
export function isDone(item: Item): boolean {
  return isClosed(item) || (item.kind === "release" && item.state === "merged");
}

/** What a thing is, as the name of its topic says it, with its repository without the owner. */
function what(item: Item, t: Texts): string {
  const repo = item.repo.slice(item.repo.indexOf("/") + 1);
  switch (item.kind) {
    case "contribution":
      return t(
        item.discussion === undefined
          ? "topic.contribution"
          : "topic.discussion",
        {
          repo,
          number: item.number,
          title: item.title.replace(/\s+/g, " ").trim(),
        },
      );
    case "alarm":
      return t("topic.alarm", { repo });
    case "workflow":
      return t("topic.workflow", { repo, name: item.name });
    case "alert":
      return t("topic.alert", { repo });
    case "advisory":
      return t("topic.advisory", { repo });
    case "release":
      return t("topic.release", { repo, version: item.version });
    case "pictures":
      return t("topic.pictures", {
        repo,
        number: item.number,
        title: item.title.replace(/\s+/g, " ").trim(),
      });
    case "reminder":
      return t(REMINDER_TOPICS[item.token ?? "claude"]);
    case "decision":
      return t("topic.decision", {
        question: item.question.replace(/\s+/g, " ").trim(),
      });
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
 * into the main view when the chat has no topics or Telegram refuses one. A topic
 * that the maintainer deleted is done for him, so the next message of its thing,
 * such as one whose message went with the topic or a bundle that opens again, opens
 * a new topic, which the thing keeps. So does a thing without a topic, such as one
 * whose topic Telegram refused, or one that an earlier version of the pager left in
 * the main view when its topic was gone: its next new message asks for a topic
 * again, and a chat without topics answers that without a call to Telegram. Only a
 * thing from before topics, which has no topic at all, stays in the main view. A
 * topic that the pager opened for this message and that took none is deleted again,
 * so that no empty topic stays. Returns the id of the message.
 */
export async function sendThing(
  context: Context,
  item: Item,
  text: string,
  buttons: Keyboard,
): Promise<number> {
  const topic: Topic | null = item.topic ?? null;
  if (topic !== null) {
    const message = await context.telegram.postInto(
      text,
      buttons,
      topic.thread,
    );
    if (message !== null) {
      return message;
    }
  } else if (item.topic === undefined && item.messageId !== null) {
    // A record from before topics has none at all, and stays in the main view.
    return context.telegram.send(text, buttons);
  }
  return sendInNewTopic(context, item, text, buttons);
}

/**
 * Send a message of a thing that opens a new topic of the thing, named after it,
 * which the thing keeps, or into the main view when Telegram refuses one. Returns
 * the id of the message.
 */
async function sendInNewTopic(
  context: Context,
  item: Item,
  text: string,
  buttons: Keyboard,
): Promise<number> {
  const name = topicName(item, context.t);
  const thread = await context.telegram.openTopic(name, COLORS[item.kind]);
  return sendInTopic(context, item, thread, name, text, buttons);
}

/**
 * Send a message of a thing into a topic that the pager just opened for it, named
 * after it, which the thing keeps, or into the main view without one. Returns the id
 * of the message.
 */
async function sendInTopic(
  context: Context,
  item: Item,
  thread: number | null,
  name: string,
  text: string,
  buttons: Keyboard,
): Promise<number> {
  const opened = await postInTopic(context, thread, name, text, buttons);
  if (opened.topic !== null) {
    await context.store.link(opened.topic.thread, item.id, isDone(item));
  }
  item.topic = opened.topic;
  return opened.message;
}

/**
 * Send a message below the message of a thing, such as the pictures of a release,
 * the notice of a new comment or a draft only to read: into the thing's topic, or
 * into the main view as a reply to its message when the thing has no topic and gets
 * none. When the maintainer deleted the topic, and the thing's message with it, the
 * thing opens a new one, as sendThing() does: its own message first, with its
 * buttons, and this one below it; the thing keeps the new topic and its new message.
 * So does a thing without a topic in a chat with topics, such as one that an earlier
 * version of the pager left in the main view when its topic was gone; a chat
 * without topics, a topic that Telegram refuses, and a thing from before topics keep
 * the message below the thing's message in the main view. Returns where the message
 * went, for an album that follows it.
 */
export async function postBelow(
  context: Context,
  item: Item,
  text: string,
  buttons: Keyboard = [],
): Promise<Sent> {
  const topic = item.topic ?? null;
  if (topic !== null) {
    const message = await context.telegram.postInto(
      text,
      buttons,
      topic.thread,
    );
    if (message !== null) {
      return { message, thread: topic.thread };
    }
  } else if (item.topic === undefined) {
    // A record from before topics stays in the main view.
    return context.telegram.post(text, buttons, null, item.messageId);
  }
  const name = topicName(item, context.t);
  const thread = await context.telegram.openTopic(name, COLORS[item.kind]);
  if (thread === null && topic === null) {
    // No topic to be had, and the thing's message is still there: below it.
    return context.telegram.post(text, buttons, null, item.messageId);
  }
  // The thing opens a new topic, as a new thing does, with its own message first.
  item.messageId = await sendInTopic(
    context,
    item,
    thread,
    name,
    render(item, context.now(), context.t),
    keyboard(item, context.t),
  );
  await context.store.put(item);
  return context.telegram.post(
    text,
    buttons,
    item.topic?.thread ?? null,
    item.messageId,
  );
}

/**
 * Send a message that opens a topic of its own, such as the first of a thing or a
 * report of a run, or into the main view when the chat has no topics or Telegram
 * refuses one. A topic that took no message is deleted again, so that no empty
 * topic stays. Returns the id of the message and its topic.
 */
export async function postInNewTopic(
  context: Context,
  name: string,
  color: TopicColor,
  text: string,
  buttons: Keyboard,
): Promise<{ message: number; topic: Topic | null }> {
  const thread = await context.telegram.openTopic(name, color);
  return postInTopic(context, thread, name, text, buttons);
}

/**
 * Send a message into a topic that the pager just opened, named as given, or into
 * the main view without one. A topic that took no message is deleted again, so that
 * no empty topic stays. Returns the id of the message and its topic.
 */
async function postInTopic(
  context: Context,
  thread: number | null,
  name: string,
  text: string,
  buttons: Keyboard,
): Promise<{ message: number; topic: Topic | null }> {
  let sent: Sent;
  try {
    sent = await context.telegram.post(text, buttons, thread);
  } catch (error) {
    // Such as too many requests at once: the topic took nothing, and the next
    // signal of a thing opens it again.
    if (thread !== null) {
      await context.telegram.removeTopic(thread);
    }
    throw error;
  }
  if (thread !== null && sent.thread === null) {
    await context.telegram.removeTopic(thread);
  }
  return {
    message: sent.message,
    topic: thread === null || sent.thread === null ? null : { thread, name },
  };
}

/**
 * Rename a thing's topic when its name changed: ✅ once it is done, without it when
 * a bundle opens again, and the new version of a release. A rename that Telegram
 * refuses keeps the old name, and the thing keeps when it was first refused: the
 * next change of the thing tries again, and so does the schedule for a day, since
 * a done thing, such as a published release, changes no more.
 */
export async function retitle(context: Context, item: Item): Promise<void> {
  const topic = item.topic ?? null;
  if (topic === null) {
    delete item.renameRefused;
    return;
  }
  const name = topicName(item, context.t);
  if (name === topic.name) {
    delete item.renameRefused;
    return;
  }
  if (await context.telegram.renameTopic(topic.thread, name)) {
    item.topic = { thread: topic.thread, name };
    delete item.renameRefused;
    await context.store.link(topic.thread, item.id, isDone(item));
  } else {
    item.renameRefused ??= context.now();
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
  /** The number of the issue, pull request or discussion of a contribution, of a release, or of the pull request of pictures. */
  number?: number;
  /** The version of a release. */
  version?: string;
  /**
   * Where GitHub shows it: the issue, the pull request, the discussion or the
   * comment that its reply answers, the pull request of pictures, or the pages
   * of a bundle and each entry.
   */
  links: string[];
  /**
   * Its message as the maintainer sees it, in the HTML of Telegram, which escapes
   * what comes from GitHub: the control repository reads it as data, never as markup.
   */
  text: string;
}

/** What a text in the topic of a thing tells the control repository about the thing. */
export function about(item: Item, now: number, t: Texts): About {
  const links: string[] = [];
  const named: Pick<About, "number" | "version"> = {};
  switch (item.kind) {
    case "contribution":
    case "pictures":
      links.push(item.url);
      named.number = item.number;
      break;
    case "advisory":
      // Its link, and its message with its id: what it says is under
      // embargo, and the pager doesn't know it.
      links.push(item.url);
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
          : securityPage(item.repo),
        ...item.entries.map((entry) => entry.url),
      );
      break;
    case "workflow":
      // The run that failed last, and the log of each job that failed in it.
      links.push(item.url, ...item.jobs.map((job) => job.url));
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
    text: cut(render(unquoted(item), now, t), MAX_ABOUT),
  };
}

/**
 * A thing without the start of what its issue, pull request, discussion or comment
 * says: the pager sends no text of GitHub to the control repository, which reads
 * it from GitHub itself, as data, when a job needs it.
 */
function unquoted(item: Item): Item {
  if (item.kind !== "contribution") {
    return item;
  }
  const { excerpt: _excerpt, ...rest } = item;
  return rest;
}
