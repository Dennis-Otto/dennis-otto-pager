/**
 * The Bot API of Telegram, for the one chat of the maintainer: send a message with
 * buttons, edit it as its thing changes, answer a button, react to a message. The
 * token of the bot is part of the address of every call, so no error and no log
 * names the address.
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

  /** Send a message with buttons; it notifies the maintainer. Returns its id. */
  async send(text: string, keyboard: Keyboard): Promise<number> {
    const result = (await this.call("sendMessage", {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard },
    })) as { message_id: number };
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
    const result = (await this.call("sendMessage", {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      reply_markup: { force_reply: true, input_field_placeholder: placeholder },
    })) as { message_id: number };
    return result.message_id;
  }

  /** Send a plain message without buttons. */
  async say(text: string): Promise<void> {
    await this.send(text, []);
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
