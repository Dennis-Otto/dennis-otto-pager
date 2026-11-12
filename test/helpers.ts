// The test doubles of the pager: a simulated network for Telegram and GitHub, which
// records each call; settings with test values only; a clock that the tests move;
// and the private key of a test app, which each run makes anew. Nothing here is a
// real token.
import { env } from "cloudflare:test";

import { makeContext } from "../src/context.ts";
import { forget } from "../src/github.ts";
import type { Context } from "../src/pager.ts";
import type { Apart } from "../src/schedule.ts";
import type { PagerEnv, Settings } from "../src/settings.ts";
import type { Item } from "../src/store.ts";
import type { Fetch } from "../src/telegram.ts";

export const CHAT = 4242;

/** A step of the schedule called on its own, outside a run: an error of a thing passes on. */
export const directly: Apart = async (_thing, work) => {
  await work();
  return true;
};
export const START = Date.parse("2026-11-04T08:00:00Z");
/** The first page of the deliveries of the app's webhook, which each run of the schedule reads. */
export const DELIVERIES =
  "https://api.github.com/app/hook/deliveries?per_page=100";
/** The first page of the failures of the webhook, which each run of the schedule reads first. */
export const FAILURES = `${DELIVERIES}&status=failure`;
/** The limits of the API, from which the schedule reads when GITHUB_USER_TOKEN expires, once a day. */
export const RATE_LIMIT = "https://api.github.com/rate_limit";

export interface Call {
  method: string;
  url: string;
  // biome-ignore lint/suspicious/noExplicitAny: the recorded JSON of a call, whatever it holds.
  body: any;
  /** Its headers, by their names in lower case. */
  headers: Record<string, string>;
}

type Handler = (call: Call) => Response | undefined;

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/**
 * The body of a call as the tests read it: its JSON, or the fields of a form, each
 * file as its name, type and size.
 */
// biome-ignore lint/suspicious/noExplicitAny: the recorded body of a call, whatever it holds.
function recorded(body: RequestInit["body"]): any {
  if (body instanceof FormData) {
    return Object.fromEntries(
      [...body.entries()].map(([name, value]) => [
        name,
        typeof value === "string"
          ? value
          : { file: value.name, type: value.type, size: value.size },
      ]),
    );
  }
  const text = body === undefined || body === null ? "" : String(body);
  return text === "" ? undefined : JSON.parse(text);
}

/**
 * The simulated network: Telegram answers ok, GitHub hands out tokens, lists no
 * delivery of the webhook and names no day on which GITHUB_USER_TOKEN expires.
 */
export class Net {
  calls: Call[] = [];
  private handlers: Handler[] = [];
  private nextMessage = 100;

  /**
   * Answer the calls whose method and address match; a later rule wins, and one
   * that answers undefined for a call leaves it to the rules before it.
   */
  on(
    method: string,
    pattern: string | RegExp,
    answer: (call: Call) => Response | undefined,
  ): this {
    this.handlers.unshift((call) => {
      const matches =
        typeof pattern === "string"
          ? call.url.endsWith(pattern)
          : pattern.test(call.url);
      return call.method === method && matches ? answer(call) : undefined;
    });
    return this;
  }

  fetch: Fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      body: recorded(init?.body),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    this.calls.push(call);
    for (const handler of this.handlers) {
      const answer = handler(call);
      if (answer !== undefined) {
        return answer;
      }
    }
    if (url.startsWith("https://api.telegram.org/")) {
      const result = /\/(sendMessage)$/.test(url)
        ? { message_id: this.nextMessage++ }
        : true;
      return json({ ok: true, result });
    }
    if (url === DELIVERIES || url === FAILURES) {
      return json([]);
    }
    if (url === RATE_LIMIT) {
      return json({ resources: {} });
    }
    if (url.endsWith("/access_tokens")) {
      return json({
        token: `ghs_test_${this.calls.length}`,
        expires_at: new Date(START + 3600000).toISOString(),
      });
    }
    return json({ message: "Not Found" }, 404);
  };

  /** The id that the fake Bot API gave the last message it sent. */
  get lastMessageId(): number {
    return this.nextMessage - 1;
  }

  /** The calls of a method of the Bot API, such as sendMessage. */
  telegram(method: string): Call[] {
    return this.calls.filter((call) =>
      call.url.endsWith(`/bot123:test/${method}`),
    );
  }

  /** The calls to GitHub whose address ends with path. */
  github(path: string): Call[] {
    return this.calls.filter(
      (call) =>
        call.url.startsWith("https://api.github.com/") &&
        call.url.endsWith(path),
    );
  }
}

let key: Promise<{ pem: string; publicKey: CryptoKey; pkcs8: ArrayBuffer }>;

function pem(der: ArrayBuffer, label: string): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** The private key of a test app, made once per run of the tests. */
export function appKey(): Promise<{
  pem: string;
  publicKey: CryptoKey;
  pkcs8: ArrayBuffer;
}> {
  key ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const pkcs8 = (await crypto.subtle.exportKey(
      "pkcs8",
      pair.privateKey,
    )) as ArrayBuffer;
    return { pem: pem(pkcs8, "PRIVATE KEY"), publicKey: pair.publicKey, pkcs8 };
  })();
  return key;
}

/** A key of PKCS #8 as PEM of PKCS #1, as GitHub hands out the key of an app. */
export function asPkcs1(pkcs8: ArrayBuffer): string {
  // A key of 2048 bits: 4 bytes of the sequence, 3 of the version, 15 of the
  // algorithm and 4 of the octet string come before the key of PKCS #1.
  return pem(pkcs8.slice(26), "RSA PRIVATE KEY");
}

export async function settings(
  overrides: Partial<Settings> = {},
): Promise<Settings> {
  return {
    telegramToken: "123:test",
    telegramSecret: "telegram-secret",
    chatId: CHAT,
    githubSecret: "github-secret",
    appId: "12345",
    appKey: (await appKey()).pem,
    controlSecret: "control-secret",
    userToken: "user-token",
    maintainer: "Dennis-Otto",
    owners: [],
    controlRepository: "Dennis-Otto/control",
    laterHours: 4,
    tokenExpires: null,
    language: "en",
    ...overrides,
  };
}

export interface World {
  net: Net;
  context: Context;
  clock: { now: number };
  /** The waits of the pager, which pass at once in the tests. */
  sleeps: number[];
}

/** A fresh world: an empty KV, no cached token, the network and the clock. */
export async function world(overrides: Partial<Settings> = {}): Promise<World> {
  forget();
  const listed = await env.PAGER.list();
  await Promise.all(listed.keys.map((each) => env.PAGER.delete(each.name)));
  const net = new Net();
  const clock = { now: START };
  const sleeps: number[] = [];
  const context = makeContext(
    await settings(overrides),
    env as PagerEnv,
    net.fetch,
    () => clock.now,
    async (milliseconds) => {
      sleeps.push(milliseconds);
    },
  );
  return { net, context, clock, sleeps };
}

/** The installation of the app on the control repository, for the tests that use it. */
export function withControl(net: Net, installation = 77): Net {
  return net.on("GET", "/repos/Dennis-Otto/control/installation", () =>
    json({ id: installation }),
  );
}

export const REPO = "Dennis-Otto/demo";

/** A thing as the store keeps it, for the tests of the buttons. */
export function base(
  id: string,
): Pick<
  Item,
  "id" | "repo" | "installation" | "messageId" | "note" | "snoozedUntil"
> {
  return {
    id,
    repo: REPO,
    installation: 9,
    messageId: 7,
    note: null,
    snoozedUntil: null,
  };
}

/**
 * A chat with topics, as Threaded Mode in @BotFather makes it: getMe says so, and
 * each createForumTopic opens the next thread, from first on.
 */
export function withTopics(net: Net, first = 900): Net {
  let next = first;
  return net
    .on("POST", /\/getMe$/, () =>
      json({
        ok: true,
        result: { id: 1, is_bot: true, has_topics_enabled: true },
      }),
    )
    .on("POST", /\/createForumTopic$/, () =>
      json({ ok: true, result: { message_thread_id: next++, name: "topic" } }),
    );
}

/**
 * A topic that the maintainer deleted, and with it each of its messages, as
 * messages names them: Telegram finds neither the thread for a new message or an
 * album nor a message of it to edit.
 */
export function withDeletedTopic(
  net: Net,
  thread: number,
  messages: readonly number[] = [],
): Net {
  const refused = (description: string) =>
    json({ ok: false, error_code: 400, description }, 400);
  return net
    .on("POST", /\/(sendMessage|sendMediaGroup|sendPhoto)$/, (call) =>
      Number(call.body.message_thread_id) === thread
        ? refused("Bad Request: message thread not found")
        : undefined,
    )
    .on("POST", /\/editMessageText$/, (call) =>
      messages.includes(call.body.message_id)
        ? refused("Bad Request: message to edit not found")
        : undefined,
    );
}
