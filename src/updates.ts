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
import { type Decision, type Item, MAX_ANSWER } from "./store.ts";
import { REACTIONS, threadOf } from "./telegram.ts";
import { about } from "./topics.ts";

interface Message {
  message_id: number;
  chat?: { id?: number };
  from?: { id?: number };
  text?: string;
  reply_to_message?: { message_id?: number; text?: string };
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

/** The most of the message that a free text answers which goes along with it. */
export const MAX_REPLY = 1000;

async function pressed(
  context: Context,
  query: NonNullable<Update["callback_query"]>,
): Promise<string> {
  const parsed = parsePress(query.data ?? "");
  if (parsed === null) {
    await context.telegram.answer(query.id, context.t("answer.unknown"), true);
    return "an unknown button";
  }
  const item = await context.store.get(parsed.id);
  if (item === null) {
    await context.telegram.answer(query.id, context.t("answer.gone"), true);
    // Its own message went with it, so this is a proposal's: its button goes too.
    if (query.message?.message_id !== undefined) {
      await context.telegram.clear(query.message.message_id);
    }
    return "a button of a thing that is gone";
  }
  const reply = await press(context, item, parsed);
  await context.telegram.answer(query.id, reply.text, reply.alert);
  // A button of another message than the thing's own is that of a proposal of the
  // control repository: it acts once, so it goes.
  const shownIn = query.message?.message_id;
  if (shownIn !== undefined && shownIn !== item.messageId) {
    await context.telegram.clear(shownIn);
  }
  return `${parsed.action}: ${reply.text}`;
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
  await context.store.setPendingEdit(null);
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
  delete item.discussion?.redraft;
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

async function freeText(
  context: Context,
  message: Message,
  text: string,
  item: Item | null,
): Promise<string> {
  const thread = threadOf(message);
  const repo = context.settings.controlRepository;
  const installation = await context.github.installation(repo);
  if (installation === null) {
    await context.telegram.say(
      context.t("chat.noControl", { repo: html(repo) }),
      thread,
    );
    return "free text without a control repository";
  }
  // The message that the text answers, if any, says what "it" is, and so does the
  // thing whose topic the text came from: the control repository reads both as
  // data, as everything else. A topic that the maintainer opened, and General,
  // have no thing: the text starts a conversation of its own.
  const answered = message.reply_to_message?.text?.trim() ?? "";
  await context.github.dispatch(installation, repo, "pager-text", {
    text,
    message: message.message_id,
    ...(answered === "" ? {} : { reply: answered.slice(0, MAX_REPLY) }),
    ...(item === null ? {} : { thing: about(item, context.now(), context.t) }),
    language: context.t.language,
  });
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
  const text = message.text?.trim() ?? "";
  if (text === "") {
    return "a message without text";
  }
  if (/^\/(start|help)\b/.test(text)) {
    await context.telegram.say(context.t("chat.help"), threadOf(message));
    return "help";
  }
  const pending = await context.store.pendingEdit();
  if (
    pending !== null &&
    message.reply_to_message?.message_id === pending.prompt
  ) {
    return edited(context, message, text, pending.item, pending.prompt);
  }
  const thread = threadOf(message);
  const item = thread === null ? null : await context.store.byTopic(thread);
  if (item?.kind === "decision" && item.state === "open") {
    return answerInWords(context, message, text, item);
  }
  return freeText(context, message, text, item);
}
