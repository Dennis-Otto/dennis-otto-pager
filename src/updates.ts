/**
 * The updates of Telegram: a pressed button, or a text of the maintainer. Only the
 * chat whose id TELEGRAM_CHAT_ID names is served, and only its own user; every
 * other update is dropped without an answer. An answer to a text goes into the
 * thread that the text came from, and a text in the topic of a thing goes to the
 * control repository with that thing. A text in the topic of an open question of
 * an agent is its answer, in the maintainer's own words.
 */
import { answerDecision, press } from "./actions.ts";
import { parsePress } from "./buttons.ts";
import { GitHubError } from "./github.ts";
import { type Context, show } from "./pager.ts";
import { html } from "./render.ts";
import { answering, type Decision, type Item, MAX_ANSWER } from "./store.ts";
import { REACTIONS, threadOf } from "./telegram.ts";
import { about } from "./topics.ts";

/**
 * The fields of a message of Telegram that carry what the pager can't read: a
 * photo, a file, a voice message and the like. Their words, if any, come in
 * `caption`. A service message, such as a topic that the maintainer renamed,
 * has none of them, and stays without an answer.
 */
const UNREAD = [
  "photo",
  "document",
  "voice",
  "audio",
  "video",
  "video_note",
  "animation",
  "sticker",
  "location",
  "venue",
  "contact",
  "poll",
  "dice",
  "story",
  "paid_media",
] as const;

interface Message extends Partial<Record<(typeof UNREAD)[number], unknown>> {
  message_id: number;
  chat?: { id?: number };
  from?: { id?: number };
  text?: string;
  /** The words below a photo, a file or a voice message, which has no text. */
  caption?: string;
  reply_to_message?: { message_id?: number; text?: string; caption?: string };
  /** The thread that the message came from, in Threaded Mode. */
  message_thread_id?: number;
  /** Set as well in a thread; the id alone decides, as threadOf() says. */
  is_topic_message?: boolean;
  /** The service message of a topic that the maintainer opened. */
  forum_topic_created?: object;
}

export interface Update {
  update_id?: number;
  message?: Message;
  callback_query?: {
    id: string;
    from?: { id?: number };
    data?: string;
    /** The message whose button was pressed. */
    message?: { message_id?: number };
  };
}

/** The longest draft that a message shows whole, so "Send" posts what it showed. */
export const MAX_DRAFT = 3000;

/*
 * MAX_TEXT and MAX_REPLY keep the contract of the control repository: they are
 * `text` and `reply` of `MAX` in pager/core.mjs of repo-pager-control-template,
 * whose job refuses a longer text without an answer, so a change of one side
 * changes the other.
 */

/** The longest free text that the control repository takes. */
export const MAX_TEXT = 4000;

/** The most of the message that a free text answers which goes along with it. */
export const MAX_REPLY = 1000;

/** The answer to a pressed button: a short note, or an alert that waits for "OK". */
type Answer = (text: string, alert: boolean) => Promise<void>;

/**
 * A pressed button. Every press gets an answer, or Telegram shows the button's
 * loading state until it gives up and the maintainer can't tell whether the press
 * acted: a press whose handling fails before its answer, such as on an edit that
 * Telegram refuses or a write of Workers KV, gets an alert that says so, and its
 * error goes on to the log of the route.
 */
async function pressed(
  context: Context,
  query: NonNullable<Update["callback_query"]>,
): Promise<string> {
  let answered = false;
  const answer: Answer = async (text, alert) => {
    await context.telegram.answer(query.id, text, alert);
    answered = true;
  };
  try {
    return await act(context, query, answer);
  } catch (error) {
    if (!answered) {
      await quietly(answer(context.t("answer.failed"), true));
    }
    throw error;
  }
}

async function act(
  context: Context,
  query: NonNullable<Update["callback_query"]>,
  answer: Answer,
): Promise<string> {
  const parsed = parsePress(query.data ?? "");
  if (parsed === null) {
    await answer(context.t("answer.unknown"), true);
    return "an unknown button";
  }
  const item = await context.store.get(parsed.id);
  if (item === null) {
    await answer(context.t("answer.gone"), true);
    // Its own message went with it, so this is a proposal's: its button goes too.
    if (query.message?.message_id !== undefined) {
      await context.telegram.clear(query.message.message_id);
    }
    return "a button of a thing that is gone";
  }
  const reply = await press(context, item, parsed);
  await answer(reply.text, reply.alert);
  // A button of another message than the thing's own is that of a proposal of the
  // control repository: it acts once, so it goes.
  const shownIn = query.message?.message_id;
  if (shownIn !== undefined && shownIn !== item.messageId) {
    await context.telegram.clear(shownIn);
  }
  return `${parsed.action}: ${reply.text}`;
}

/**
 * Wait for a call of Telegram that tells the maintainer about a failure, and let
 * its own error go: the error that matters is the first one, which the route logs,
 * and Telegram may well be what failed.
 */
async function quietly(call: Promise<void>): Promise<void> {
  try {
    await call;
  } catch {
    // The first error goes to the log; this one says nothing new.
  }
}

async function edited(
  context: Context,
  message: Message,
  text: string,
  itemId: string,
  prompt: number,
): Promise<string> {
  const thread = threadOf(message);
  const item = await context.store.get(itemId);
  await context.store.clearPendingEdit(prompt);
  await context.telegram.remove(prompt);
  if (
    item?.kind !== "contribution" ||
    !["draft", "drafting"].includes(item.state)
  ) {
    await context.telegram.say(context.t("edit.gone"), thread);
    return "an edit of a draft that is gone";
  }
  if (text.length > MAX_DRAFT) {
    await context.telegram.say(
      context.t("edit.tooLong", { length: text.length, max: MAX_DRAFT }),
      thread,
    );
    return "an edit that is too long";
  }
  item.draft = text;
  item.draftVersion += 1;
  item.state = "draft";
  item.note = null;
  // The draft is the maintainer's own now: no draft of the control repository
  // replaces it, not even that of a job which still runs, such as one for a newer
  // comment of a discussion, so the pager waits for none.
  item.ownDraft = true;
  delete item.jobStarted;
  delete answering(item)?.redraft;
  await show(context, item, true);
  await context.telegram.remove(message.message_id);
  return "draft edited";
}

/**
 * A text in the topic of an open question of an agent: its answer, in the
 * maintainer's own words, saved where a button saves its option, so that the agent
 * reads it alike. The text gets 👍 once it is saved, and 😢 when GitHub refuses it,
 * which leaves the question open for another text or a button.
 */
async function answerInWords(
  context: Context,
  message: Message,
  text: string,
  item: Decision,
): Promise<string> {
  const thread = threadOf(message);
  if (text.length > MAX_ANSWER) {
    await context.telegram.say(
      context.t("decision.tooLong", { length: text.length, max: MAX_ANSWER }),
      thread,
    );
    return "an answer that is too long";
  }
  try {
    await answerDecision(context, item, null, text);
  } catch (error) {
    if (!(error instanceof GitHubError)) {
      throw error;
    }
    await context.telegram.say(
      context.t("decision.notSaved", { detail: html(error.detail) }),
      thread,
    );
    await context.telegram.react(message.message_id, REACTIONS.failed);
    return "an answer that GitHub refused";
  }
  await context.telegram.react(message.message_id, REACTIONS.answered);
  return "an answer in words";
}

/**
 * How far the handling of a text got: once it has reached a run of the control
 * repository, a later failure must not tell the maintainer to write it again,
 * which would start a second run of Claude, since the answer of the first can
 * still come.
 */
interface Progress {
  sent: boolean;
}

async function freeText(
  context: Context,
  message: Message,
  text: string,
  item: Item | null,
  progress: Progress,
): Promise<string> {
  const thread = threadOf(message);
  // The control repository would refuse a longer text in a run that fails without
  // an answer, so the text would show 👀 for an hour and then 😢 without a reason:
  // the pager says so at once and sends nothing, as for a draft that is too long.
  if (text.length > MAX_TEXT) {
    await context.telegram.say(
      context.t("chat.tooLong", { length: text.length, max: MAX_TEXT }),
      thread,
    );
    return "free text that is too long";
  }
  const repo = context.settings.controlRepository;
  try {
    const installation = await context.github.installation(repo);
    if (installation === null) {
      await context.telegram.say(
        context.t("chat.noControl", { repo: html(repo) }),
        thread,
      );
      return "free text without a control repository";
    }
    // The message that the text answers, if any, says what "it" is, and so does
    // the thing whose topic the text came from: the control repository reads both
    // as data, as everything else. A topic that the maintainer opened, and
    // General, have no thing: the text starts a conversation of its own.
    // A picture of the visual check, which the pager sends with a caption, has no
    // text, so its caption says what the reply is about.
    const replied = message.reply_to_message;
    const answered = (replied?.text ?? replied?.caption)?.trim() ?? "";
    await context.github.dispatch(installation, repo, "pager-text", {
      text,
      message: message.message_id,
      ...(answered === "" ? {} : { reply: answered.slice(0, MAX_REPLY) }),
      ...(item === null
        ? {}
        : { thing: about(item, context.now(), context.t) }),
      language: context.t.language,
    });
  } catch (error) {
    if (!(error instanceof GitHubError)) {
      throw error;
    }
    // GitHub refused it, so it reached no run: the text says why, as an answer in
    // words does, and waits for no answer.
    await context.telegram.say(
      context.t("chat.notSent", { detail: html(error.detail) }),
      thread,
    );
    await context.telegram.react(message.message_id, REACTIONS.failed);
    return "free text that GitHub refused";
  }
  progress.sent = true;
  await context.telegram.react(message.message_id, REACTIONS.taken);
  // Its answer turns the 👀 into 👍, or the schedule into 😢 when none comes; the
  // answer goes into the thread that the text came from, which the store keeps.
  await context.store.ask(message.message_id, context.now(), thread);
  return "free text sent";
}

/** Handle one update of Telegram; returns what happened, for the log of the test. */
export async function handleUpdate(
  context: Context,
  update: Update,
): Promise<string> {
  const chat = context.settings.chatId;
  const query = update.callback_query;
  if (query !== undefined) {
    if (query.from?.id !== chat) {
      return "a button of a stranger";
    }
    return pressed(context, query);
  }
  const message = update.message;
  if (message === undefined) {
    return "an update without a message";
  }
  if (message.chat?.id !== chat || message.from?.id !== chat) {
    return "a message of a stranger";
  }
  if (message.forum_topic_created !== undefined) {
    // Its texts come with the id of the topic, and their answers go into it.
    return "a topic of the maintainer";
  }
  // Telegram puts the words of a photo or a file into its caption, never into
  // its text: they go on as a text does.
  const text = (message.text ?? message.caption)?.trim() ?? "";
  if (text === "") {
    if (UNREAD.some((field) => message[field] !== undefined)) {
      // A photo, a file or a voice message without words would get no reaction
      // at all and look like a dead pager: the answer says what it reads.
      await context.telegram.say(context.t("chat.textOnly"), threadOf(message));
      return "a message without words";
    }
    return "a message without text";
  }
  const progress: Progress = { sent: false };
  try {
    return await written(context, message, text, progress);
  } catch (error) {
    if (progress.sent) {
      // The text reached its run, whose answer can still come and turn its
      // reaction into 👍: no 😢 and no "write it again", only the log of the route.
      throw error;
    }
    // Every text gets a reaction: one whose handling fails gets 😢 and a message
    // in its thread that says so, and its error goes on to the log of the route.
    await quietly(context.telegram.react(message.message_id, REACTIONS.failed));
    await quietly(
      context.telegram.say(context.t("chat.failed"), threadOf(message)),
    );
    throw error;
  }
}

/** A text of the maintainer: help, a new draft, an answer in words or free text. */
async function written(
  context: Context,
  message: Message,
  text: string,
  progress: Progress,
): Promise<string> {
  if (/^\/(start|help)\b/.test(text)) {
    await context.telegram.say(context.t("chat.help"), threadOf(message));
    return "help";
  }
  // A reply to a prompt of ✏️ Edit is the new text of the draft that prompt asked
  // for, however many prompts wait.
  const replyTo = message.reply_to_message?.message_id;
  const pending =
    replyTo === undefined ? null : await context.store.pendingEdit(replyTo);
  if (pending !== null) {
    return edited(context, message, text, pending.item, pending.prompt);
  }
  const thread = threadOf(message);
  const item = thread === null ? null : await context.store.byTopic(thread);
  if (item?.kind === "decision" && item.state === "open") {
    return answerInWords(context, message, text, item);
  }
  return freeText(context, message, text, item, progress);
}
