/**
 * The Bot API of Telegram, for the one chat of the maintainer: send a message with
 * buttons, edit it as its thing changes, answer a button, react to a message, and
 * send pictures as an album. The
 * token of the bot is part of the address of every call, so no error and no log
 * names the address. In Threaded Mode, a message of the maintainer comes from a
 * thread, and the answer to it goes into the same; each thing of the pager gets a
 * topic of its own, which the pager opens, renames and, when it stays empty, deletes.
 */

import { inTime, NO_ANSWER, timedOut } from "./deadlines.ts";

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

/** A picture that goes as a photo: a PNG or a WebP, and its caption in the HTML of Telegram. */
export interface Photo {
  bytes: Uint8Array;
  type: "image/png" | "image/webp";
  caption: string;
}

/** Where a message went: its id, and its thread, or null for the main view. */
export interface Sent {
  message: number;
  thread: Thread;
}

/**
 * The colors of the icon of a topic, the only six that the Bot API takes; a topic
 * keeps the color that it was opened with.
 */
export const TOPIC_COLORS = {
  blue: 0x6fb9f0,
  yellow: 0xffd67e,
  violet: 0xcb86db,
  green: 0x8eee98,
  rose: 0xff93b2,
  red: 0xfb6f5f,
} as const;

export type TopicColor = (typeof TOPIC_COLORS)[keyof typeof TOPIC_COLORS];

export class TelegramError extends Error {
  readonly method: string;
  readonly description: string;

  constructor(method: string, description: string) {
    super(`Telegram ${method}: ${description}`);
    this.method = method;
    this.description = description;
  }
}

/** Whether Telegram refused a thread that it doesn't find. */
function threadNotFound(error: unknown): boolean {
  return (
    error instanceof TelegramError &&
    error.description.includes("message thread not found")
  );
}

interface Answer {
  ok?: boolean;
  error_code?: number;
  description?: string;
  result?: unknown;
  parameters?: { retry_after?: number };
}

/**
 * The longest wait, in seconds, that a call takes when Telegram asks it to wait
 * before it tries again, with a 429: an event of GitHub that waits longer would
 * run past GitHub's ten seconds, and the schedule delivers it again later.
 */
export const MAX_RETRY_AFTER = 3;

/** The photos of one album at most, as sendMediaGroup takes them. */
export const MAX_MEDIA = 10;

/** Wait so many seconds. */
export type Sleep = (seconds: number) => Promise<void>;

const sleep: Sleep = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export class Telegram {
  private readonly token: string;
  private readonly chatId: number;
  private readonly fetch: Fetch;
  private readonly wait: Sleep;
  /** Whether the chat has topics, which getMe says once per request. */
  private topicMode: boolean | undefined;

  constructor(token: string, chatId: number, fetcher: Fetch, wait = sleep) {
    this.token = token;
    this.chatId = chatId;
    this.fetch = fetcher;
    this.wait = wait;
  }

  async call(method: string, parameters: object): Promise<unknown> {
    return this.request(method, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parameters),
    });
  }

  /** A call with files, as multipart/form-data, which sets its own type. */
  private async upload(method: string, form: FormData): Promise<unknown> {
    return this.request(method, { body: form });
  }

  /**
   * A call to Telegram. When Telegram asks it to wait a little, with a 429 and
   * retry_after of at most MAX_RETRY_AFTER seconds, it waits and tries once more,
   * since a burst of messages into one chat, such as of events that come again,
   * meets the limit of the chat.
   */
  private async request(
    method: string,
    init: RequestInit,
    again = true,
  ): Promise<unknown> {
    // A call that ends at its deadline, before or while its answer comes, is
    // Telegram's error like any refusal.
    const late = () => new TelegramError(method, NO_ANSWER);
    const response = await inTime(
      this.fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        ...init,
      }),
      late,
    );
    const answer: Answer = await response
      .json<Answer>()
      .catch((error: unknown) => {
        if (timedOut(error)) {
          throw late();
        }
        return { description: `HTTP ${response.status}` };
      });
    const after = answer.parameters?.retry_after;
    if (
      again &&
      answer.error_code === 429 &&
      after !== undefined &&
      after <= MAX_RETRY_AFTER
    ) {
      await this.wait(after);
      return this.request(method, init, false);
    }
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
   * refuses them, takes the message in the main view instead, as a reply to the
   * message replyTo when one is given, such as the message of its thing.
   */
  async send(
    text: string,
    keyboard: Keyboard,
    thread: Thread = null,
    replyTo: number | null = null,
  ): Promise<number> {
    return (await this.post(text, keyboard, thread, replyTo)).message;
  }

  /** Send a message as send() does, and say where it went: into its thread, or the main view. */
  async post(
    text: string,
    keyboard: Keyboard,
    thread: Thread,
    replyTo: number | null,
  ): Promise<Sent> {
    return this.deliver(this.message(text, keyboard), thread, replyTo);
  }

  /**
   * Send a message as send() does, but into the thread alone: when Telegram
   * doesn't find the thread, nothing is sent, and it returns null. A silent one
   * notifies nobody, such as a message that moves into its topic.
   */
  async postInto(
    text: string,
    keyboard: Keyboard,
    thread: number,
    silent = false,
  ): Promise<number | null> {
    try {
      return await this.sendMessage({
        ...this.message(text, keyboard),
        message_thread_id: thread,
        ...(silent ? { disable_notification: true } : {}),
      });
    } catch (error) {
      if (!threadNotFound(error)) {
        throw error;
      }
      console.warn(`Telegram sendMessage: thread ${thread} not found`);
      return null;
    }
  }

  private message(text: string, keyboard: Keyboard): object {
    return {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard },
    };
  }

  /**
   * Send a message into its thread, or into the main view, as a reply to replyTo
   * when one is given, when it has no thread or Telegram doesn't find it. In the
   * thread, it needs no reply: the thread is what the message belongs to.
   */
  private async deliver(
    parameters: object,
    thread: Thread,
    replyTo: number | null,
  ): Promise<Sent> {
    const main =
      replyTo === null
        ? parameters
        : {
            ...parameters,
            reply_parameters: {
              message_id: replyTo,
              allow_sending_without_reply: true,
            },
          };
    if (thread === null) {
      return { message: await this.sendMessage(main), thread: null };
    }
    try {
      const message = await this.sendMessage({
        ...parameters,
        message_thread_id: thread,
      });
      return { message, thread };
    } catch (error) {
      if (!threadNotFound(error)) {
        throw error;
      }
      // The log names the thread, never the text, which may quote a private repository.
      console.warn(
        `Telegram sendMessage: thread ${thread} not found, sent to the main view`,
      );
      return { message: await this.sendMessage(main), thread: null };
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

  /**
   * Send pictures as one album, or a single one as a photo, into a thread or, as
   * send() does, into the main view as a reply to replyTo, such as the message that
   * tells what they show. Silent sends them without a notification, such as right
   * after a new message that notified already.
   */
  async album(
    photos: readonly Photo[],
    thread: Thread,
    replyTo: number | null,
    silent: boolean,
  ): Promise<void> {
    const main =
      replyTo === null
        ? {}
        : {
            reply_parameters: {
              message_id: replyTo,
              allow_sending_without_reply: true,
            },
          };
    if (thread === null) {
      await this.sendPhotos(photos, main, silent);
      return;
    }
    try {
      await this.sendPhotos(photos, { message_thread_id: thread }, silent);
    } catch (error) {
      if (!threadNotFound(error)) {
        throw error;
      }
      console.warn(
        `Telegram album: thread ${thread} not found, sent to the main view`,
      );
      await this.sendPhotos(photos, main, silent);
    }
  }

  /** sendMediaGroup for two to MAX_MEDIA photos, sendPhoto for one, with where they go. */
  private async sendPhotos(
    photos: readonly Photo[],
    where: object,
    silent: boolean,
  ): Promise<void> {
    const form = new FormData();
    const single = photos.length === 1;
    const media = photos.map((photo, index) => {
      // A single photo is the file itself, which sendPhoto takes as photo.
      const name = single ? "photo" : `p${index}`;
      const bytes = photo.bytes as Uint8Array<ArrayBuffer>;
      // The file is named after its type, image/png as p0.png.
      const file = `${name}.${photo.type.slice("image/".length)}`;
      form.set(name, new File([bytes], file, { type: photo.type }));
      return {
        type: "photo",
        media: `attach://${name}`,
        caption: photo.caption,
        parse_mode: "HTML",
      };
    });
    const [one] = media;
    const fields = {
      chat_id: this.chatId,
      disable_notification: silent,
      ...where,
      ...(single ? { caption: one?.caption, parse_mode: "HTML" } : { media }),
    };
    for (const [name, value] of Object.entries(fields)) {
      form.set(name, typeof value === "string" ? value : JSON.stringify(value));
    }
    await this.upload(single ? "sendPhoto" : "sendMediaGroup", form);
  }

  /**
   * Delete a message. Returns whether it is gone: one that is gone already is, and
   * one that Telegram refuses to delete, such as one older than 48 hours, isn't.
   */
  async remove(messageId: number): Promise<boolean> {
    try {
      await this.call("deleteMessage", {
        chat_id: this.chatId,
        message_id: messageId,
      });
      return true;
    } catch (error) {
      if (!(error instanceof TelegramError)) {
        throw error;
      }
      return error.description.includes("message to delete not found");
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
   * which shows the placeholder while it is empty: in the topic of its thing, or in
   * the main view as a reply to the message of its thing.
   */
  async prompt(
    text: string,
    placeholder: string,
    thread: Thread = null,
    replyTo: number | null = null,
  ): Promise<number> {
    const sent = await this.deliver(
      {
        chat_id: this.chatId,
        text,
        parse_mode: "HTML",
        reply_markup: {
          force_reply: true,
          input_field_placeholder: placeholder,
        },
      },
      thread,
      replyTo,
    );
    return sent.message;
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

  /**
   * Whether the private chat of the bot has topics: Threaded Mode, which the
   * maintainer switches on in @BotFather, makes getMe say has_topics_enabled. Asked
   * once per request; a refused getMe counts as no topics.
   */
  async topics(): Promise<boolean> {
    if (this.topicMode === undefined) {
      try {
        const me = (await this.call("getMe", {})) as {
          has_topics_enabled?: unknown;
        } | null;
        this.topicMode = me?.has_topics_enabled === true;
      } catch (error) {
        if (!(error instanceof TelegramError)) {
          throw error;
        }
        console.warn(`Telegram getMe: ${error.description}; no topics`);
        this.topicMode = false;
      }
    }
    return this.topicMode;
  }

  /**
   * Open a topic in the chat, with a name and the color of its icon. Returns its
   * thread; "refused" when Telegram refuses one with a Bad Request, as it refused
   * every new topic of a private chat with BOT_TOPIC_WRONG_HOME from 9 November 2026
   * (tdlib/telegram-bot-api#944), and may leave its notice that the topic was
   * created in the main view all the same; or null when the chat has no topics or
   * Telegram fails otherwise, such as with a 5xx, which passes. Without a topic the
   * thing goes into the main view, as before topics.
   */
  async openTopic(
    name: string,
    color: TopicColor,
  ): Promise<number | "refused" | null> {
    if (!(await this.topics())) {
      return null;
    }
    try {
      const topic = (await this.call("createForumTopic", {
        chat_id: this.chatId,
        name,
        icon_color: color,
      })) as { message_thread_id?: unknown } | null;
      return threadOf(topic ?? {});
    } catch (error) {
      if (!(error instanceof TelegramError)) {
        throw error;
      }
      // The log leaves out the name, which may quote an issue of a private repository.
      console.warn(
        `Telegram createForumTopic: ${error.description}; sent to the main view`,
      );
      return error.description.startsWith("Bad Request") ? "refused" : null;
    }
  }

  /**
   * Rename a topic, such as with ✅ once its thing is done. Returns whether it has
   * the name now: a topic that is gone, or a refusal, keeps the old one, and the
   * next change of its thing tries again.
   */
  async renameTopic(thread: number, name: string): Promise<boolean> {
    try {
      await this.call("editForumTopic", {
        chat_id: this.chatId,
        message_thread_id: thread,
        name,
      });
      return true;
    } catch (error) {
      if (!(error instanceof TelegramError)) {
        throw error;
      }
      if (error.description.includes("TOPIC_NOT_MODIFIED")) {
        return true;
      }
      console.warn(`Telegram editForumTopic: ${error.description}`);
      return false;
    }
  }

  /** Delete a topic with its messages; one that is gone already is no error. */
  async removeTopic(thread: number): Promise<void> {
    try {
      await this.call("deleteForumTopic", {
        chat_id: this.chatId,
        message_thread_id: thread,
      });
    } catch (error) {
      if (!(error instanceof TelegramError)) {
        throw error;
      }
    }
  }
}
