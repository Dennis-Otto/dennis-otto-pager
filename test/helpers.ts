// The test doubles of the pager: a simulated network for Telegram and GitHub, which
// records each call; settings with test values only; a clock that the tests move;
// and the private key of a test app, which each run makes anew. Nothing here is a
// real token.
import { env } from "cloudflare:test";

import { makeContext } from "../src/context.ts";
import { forget } from "../src/github.ts";
import type { Context } from "../src/pager.ts";
import type { PagerEnv, Settings } from "../src/settings.ts";
import type { Item } from "../src/store.ts";
import type { Fetch } from "../src/telegram.ts";

export const CHAT = 4242;
export const START = Date.parse("2026-11-04T08:00:00Z");

export interface Call {
  method: string;
  url: string;
  // biome-ignore lint/suspicious/noExplicitAny: the recorded JSON of a call, whatever it holds.
  body: any;
}

type Handler = (call: Call) => Response | undefined;

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/** The simulated network: Telegram answers ok, GitHub hands out tokens. */
export class Net {
  calls: Call[] = [];
  private handlers: Handler[] = [];
  private nextMessage = 100;

  /** Answer the calls whose method and address match; a later rule wins. */
  on(method: string, pattern: string | RegExp, answer: () => Response): this {
    this.handlers.unshift((call) => {
      const matches =
        typeof pattern === "string"
          ? call.url.endsWith(pattern)
          : pattern.test(call.url);
      return call.method === method && matches ? answer() : undefined;
    });
    return this;
  }

  fetch: Fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const text = init?.body === undefined ? "" : String(init.body);
    const call: Call = {
      method: init?.method ?? "GET",
      url,
      body: text === "" ? undefined : JSON.parse(text),
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
    if (url.endsWith("/access_tokens")) {
      return json({
        token: `ghs_test_${this.calls.length}`,
        expires_at: new Date(START + 3600000).toISOString(),
      });
    }
    return json({ message: "Not Found" }, 404);
  };

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
