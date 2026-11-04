/**
 * The updates of Telegram: a pressed button, or a text of the maintainer. Only the
 * chat whose id TELEGRAM_CHAT_ID names is served, and only its own user; every
 * other update is dropped without an answer.
 */
import { press } from "./actions.ts";
import { parsePress } from "./buttons.ts";
import { type Context, show } from "./pager.ts";
import { html } from "./render.ts";

interface Message {
  message_id: number;
  chat?: { id?: number };
  from?: { id?: number };
  text?: string;
  reply_to_message?: { message_id?: number; text?: string };
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

const HELP = [
  "👋 This is your pager. It writes only when something needs you, one message per thing, and edits that message as the thing changes.",
  "",
  "The buttons act on GitHub from a fixed list. Any other text goes to the control repository, which answers here; an answer that proposes an action comes with a ✅ Confirm button, and only a press acts. Reply to a message of the pager to ask about its thing.",
  "",
  "Each answer, draft and fix of the control repository is a run of Claude with your subscription: it counts against your weekly limit, and its message says how much it took.",
].join("\n");

async function pressed(
  context: Context,
  query: NonNullable<Update["callback_query"]>,
): Promise<string> {
  const parsed = parsePress(query.data ?? "");
  if (parsed === null) {
    await context.telegram.answer(query.id, "This button is unknown.", true);
    return "an unknown button";
  }
  const item = await context.store.get(parsed.id);
  if (item === null) {
    await context.telegram.answer(query.id, "This thing is gone.", true);
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
  const item = await context.store.get(itemId);
  await context.store.setPendingEdit(null);
  await context.telegram.remove(prompt);
  if (
    item?.kind !== "contribution" ||
    !["draft", "drafting"].includes(item.state)
  ) {
    await context.telegram.say("That draft is gone; nothing changed.");
    return "an edit of a draft that is gone";
  }
  if (text.length > MAX_DRAFT) {
    await context.telegram.say(
      `That text has ${text.length} characters; a reply here takes ${MAX_DRAFT} at most. Send a shorter one with ✏️ Edit.`,
    );
    return "an edit that is too long";
  }
  item.draft = text;
  item.draftVersion += 1;
  item.state = "draft";
  item.note = null;
  await show(context, item, true);
  await context.telegram.remove(message.message_id);
  return "draft edited";
}

async function freeText(
  context: Context,
  message: Message,
  text: string,
): Promise<string> {
  const repo = context.settings.controlRepository;
  const installation = await context.github.installation(repo);
  if (installation === null) {
    await context.telegram.say(
      `Free text goes to the workflow of ${html(repo)}, where the GitHub App isn't installed yet: install it there, as docs/setup.md says.`,
    );
    return "free text without a control repository";
  }
  // The message that the text answers, if any, says what "it" is: the control
  // repository reads it as data, as everything else.
  const answered = message.reply_to_message?.text?.trim() ?? "";
  await context.github.dispatch(installation, repo, "pager-text", {
    text,
    message: message.message_id,
    ...(answered === "" ? {} : { reply: answered.slice(0, MAX_REPLY) }),
  });
  await context.telegram.react(message.message_id, "👀");
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
  const text = message.text?.trim() ?? "";
  if (text === "") {
    return "a message without text";
  }
  if (/^\/(start|help)\b/.test(text)) {
    await context.telegram.say(HELP);
    return "help";
  }
  const pending = await context.store.pendingEdit();
  if (
    pending !== null &&
    message.reply_to_message?.message_id === pending.prompt
  ) {
    return edited(context, message, text, pending.item, pending.prompt);
  }
  return freeText(context, message, text);
}
