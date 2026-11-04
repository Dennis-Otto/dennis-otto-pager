/**
 * The Bot API of Telegram, for the one chat of the maintainer: send a message with
 * buttons, edit it as its thing changes, answer a button, react to a message. The
 * token of the bot is part of the address of every call, so no error and no log
 * names the address. In Threaded Mode, a message of the maintainer comes from a
 * thread, and the answer to it goes into the same.
 */

export type Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface Button {
  text: string;
  callback_data: string;
}

export type Keyboard = Button[][];

/**
 * The reactions of the pager on a text of the maintainer that goes to the control
 * repository: taken, answered, and no answer. A bot may react only with an emoji of
 * the fixed list of ReactionTypeEmoji in Telegram's Bot API, which has no ✅: 👍 is
 * the closest to it, and 😢 says plainly that no answer came.
 */
export const REACTIONS = {
  taken: "👀",
  answered: "👍",
  failed: "😢",
} as const;

export type Reaction = (typeof REACTIONS)[keyof typeof REACTIONS];

/**
 * A thread of the chat, by its id, or null for the main view. Since the Bot API 9.3,
 * a private chat with a bot in Threaded Mode has threads, and each new message of
 * the maintainer can start one of its own.
 */
export type Thread = number | null;

/** General, the first thread of a chat, whose messages the Bot API takes without an id. */
const GENERAL = 1;

/**
 * The thread that the answer to a message of the maintainer goes into: the one that
 * the message came from, or null for General and for a chat without threads.
 * The id alone decides, without is_topic_message: the chat of the pager is private,
 * where a message has an id of a thread only in a thread, and a wrong one falls
 * back to the main view in send().
 */
export function threadOf(message: { message_thread_id?: unknown }): Thread {
  const thread = message.message_thread_id;
  return Number.isSafeInteger(thread) && (thread as number) > GENERAL
    ? (thread as number)
    : null;
}

export class TelegramError extends Error {
  readonly method: string;
  readonly description: string;

  constructor(method: string, description: string) {
    super(`Telegram ${method}: ${description}`);
    this.method = method;
    this.description = description;
  }
}

interface Answer {
  ok?: boolean;
  description?: string;
  result?: unknown;
}

export class Telegram {
  private readonly token: string;
  private readonly chatId: number;
  private readonly fetch: Fetch;

  constructor(token: string, chatId: number, fetcher: Fetch) {
    this.token = token;
    this.chatId = chatId;
    this.fetch = fetcher;
  }

  async call(method: string, parameters: object): Promise<unknown> {
    const response = await this.fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parameters),
      },
    );
    const answer: Answer = await response
      .json<Answer>()
      .catch(() => ({ description: `HTTP ${response.status}` }));
    if (answer.ok !== true) {
      throw new TelegramError(
        method,
        answer.description ?? `HTTP ${response.status}`,
      );
    }
    return answer.result;
  }

  /**
   * Send a message with buttons, into a thread or the main view; it notifies the
   * maintainer. Returns its id. A thread that Telegram doesn't find, such as one
   * that the maintainer deleted, or any in a chat where a rollout of Telegram
   * refuses them, takes the message in the main view instead.
   */
  async send(
    text: string,
    keyboard: Keyboard,
    thread: Thread = null,
  ): Promise<number> {
    const parameters = {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard },
    };
    if (thread === null) {
      return this.sendMessage(parameters);
    }
    try {
      return await this.sendMessage({
        ...parameters,
        message_thread_id: thread,
      });
    } catch (error) {
      if (
        !(error instanceof TelegramError) ||
        !error.description.includes("message thread not found")
      ) {
        throw error;
      }
      // The log names the thread, never the text, which may quote a private repository.
      console.warn(
        `Telegram sendMessage: thread ${thread} not found, sent to the main view`,
      );
      return this.sendMessage(parameters);
    }
  }

  private async sendMessage(parameters: object): Promise<number> {
    const result = (await this.call("sendMessage", parameters)) as {
      message_id: number;
    };
    return result.message_id;
  }

  /**
   * Edit a message in place, which notifies nobody. Returns false when the message
   * is gone, such as one that the maintainer deleted, so that a new one is sent.
   */
  async edit(
    messageId: number,
    text: string,
    keyboard: Keyboard,
  ): Promise<boolean> {
    try {
      await this.call("editMessageText", {
        chat_id: this.chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: keyboard },
      });
      return true;
    } catch (error) {
      if (error instanceof TelegramError) {
        if (error.description.includes("message is not modified")) {
          return true;
        }
        if (error.description.includes("message to edit not found")) {
          return false;
        }
      }
      throw error;
    }
  }

  /** Delete a message; one that is gone already is no error. */
  async remove(messageId: number): Promise<void> {
    try {
      await this.call("deleteMessage", {
        chat_id: this.chatId,
        message_id: messageId,
      });
    } catch (error) {
      if (!(error instanceof TelegramError)) {
        throw error;
      }
    }
  }

  /**
   * Take the buttons off a message, such as a proposal whose ✅ Confirm was pressed;
   * a message that is gone, or has none, is no error.
   */
  async clear(messageId: number): Promise<void> {
    try {
      await this.call("editMessageReplyMarkup", {
        chat_id: this.chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
    } catch (error) {
      if (!(error instanceof TelegramError)) {
        throw error;
      }
    }
  }

  /** End the spinner of a button, with a short text, or a dialog for an alert. */
  async answer(callbackId: string, text: string, alert = false): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: text.slice(0, 200),
      show_alert: alert,
    });
  }

  /**
   * Ask for a text in reply to a message of the pager, with Telegram's reply field,
   * which shows the placeholder while it is empty.
   */
  async prompt(text: string, placeholder: string): Promise<number> {
    return this.sendMessage({
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { force_reply: true, input_field_placeholder: placeholder },
    });
  }

  /** Send a plain message without buttons, into a thread or the main view. */
  async say(text: string, thread: Thread = null): Promise<void> {
    await this.send(text, [], thread);
  }

  /**
   * React to a message of the maintainer, which says where its text is without a new
   * message: a bot has one reaction per message, so it replaces the one before. A
   * message that is gone is no error.
   */
  async react(messageId: number, emoji: Reaction): Promise<void> {
    try {
      await this.call("setMessageReaction", {
        chat_id: this.chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji }],
      });
    } catch (error) {
      if (!(error instanceof TelegramError)) {
        throw error;
      }
    }
  }
}
