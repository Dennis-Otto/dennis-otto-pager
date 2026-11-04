// The two APIs against the simulated network: the JWT and the scoped tokens of the
// GitHub App, each call of GitHub, and the Bot API of Telegram with its errors.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appJwt,
  forget,
  GitHub,
  GitHubError,
  pemToPkcs8,
  pkcs1ToPkcs8,
} from "../src/github.ts";
import {
  REACTIONS,
  Telegram,
  TelegramError,
  threadOf,
} from "../src/telegram.ts";
import { appKey, asPkcs1, json, Net, START } from "./helpers.ts";

function decode(part: string): unknown {
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
}

async function github(net: Net, userToken: string | null = "user-token") {
  return new GitHub(
    "12345",
    (await appKey()).pem,
    userToken,
    net.fetch,
    () => START,
  );
}

beforeEach(() => {
  forget();
});

describe("the GitHub App", () => {
  it("signs a JWT that the public key of the app verifies", async () => {
    const key = await appKey();
    const jwt = await appJwt("12345", key.pem, START);
    const [header, payload, signature] = jwt.split(".") as [
      string,
      string,
      string,
    ];
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(payload)).toEqual({
      iat: START / 1000 - 60,
      exp: START / 1000 + 540,
      iss: "12345",
    });
    const bytes = Uint8Array.from(
      atob(signature.replace(/-/g, "+").replace(/_/g, "/")),
      (char) => char.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key.publicKey,
      bytes,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(valid).toBe(true);
  });

  it("takes the key as GitHub hands it out, in PKCS #1, and with escaped line breaks", async () => {
    const key = await appKey();
    const pkcs1 = asPkcs1(key.pkcs8);
    expect(pemToPkcs8(pkcs1)).toEqual(new Uint8Array(key.pkcs8));
    expect(pemToPkcs8(key.pem.replace(/\n/g, "\\n"))).toEqual(
      new Uint8Array(key.pkcs8),
    );
    expect(await appJwt("1", pkcs1, START)).toMatch(/^ey/);
    expect(() => pemToPkcs8("no key")).toThrow("holds no private key");
  });

  it("wraps short keys with a short length", () => {
    expect(
      Array.from(pkcs1ToPkcs8(new Uint8Array([1, 2])).slice(0, 2)),
    ).toEqual([0x30, 0x16]);
  });

  it("asks for a token of one repository with the permissions of the call, once", async () => {
    const net = new Net().on("GET", "/repos/Dennis-Otto/demo/pulls/3", () =>
      json({ number: 3, state: "open" }),
    );
    const api = await github(net);
    expect(await api.pullRequest(9, "Dennis-Otto/demo", 3)).toEqual({
      number: 3,
      state: "open",
    });
    await api.pullRequest(9, "Dennis-Otto/demo", 3);
    const asked = net.github("/app/installations/9/access_tokens");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.body).toEqual({
      repositories: ["demo"],
      permissions: { pull_requests: "read" },
    });
    const pulls = net.github("/pulls/3");
    expect(pulls[0]?.method).toBe("GET");
  });

  it("asks again for a token that is about to expire", async () => {
    let now = START;
    const net = new Net().on("POST", "/access_tokens", () =>
      json({
        token: "t",
        expires_at: new Date(START + 6 * 60000).toISOString(),
      }),
    );
    const api = new GitHub(
      "1",
      (await appKey()).pem,
      null,
      net.fetch,
      () => now,
    );
    await api.token(9, "Dennis-Otto/demo", { metadata: "read" });
    now += 2 * 60000;
    await api.token(9, "Dennis-Otto/demo", { metadata: "read" });
    expect(net.github("/access_tokens")).toHaveLength(2);
    await api.token(9, "plain", { metadata: "read" });
    expect(net.github("/access_tokens")[2]?.body.repositories).toEqual([
      "plain",
    ]);
  });

  it("finds its installation on a repository, or none", async () => {
    const net = new Net().on(
      "GET",
      "/repos/Dennis-Otto/control/installation",
      () => json({ id: 77 }),
    );
    const api = await github(net);
    expect(await api.installation("Dennis-Otto/control")).toBe(77);
    expect(await api.installation("Dennis-Otto/other")).toBeNull();
    const failing = new Net().on("GET", /installation$/, () =>
      json({ message: "Bad" }, 500),
    );
    await expect((await github(failing)).installation("x/y")).rejects.toThrow(
      "GitHub answered 500: Bad",
    );
  });

  it("merges by squash, only at the head that was shown", async () => {
    const net = new Net().on("PUT", "/pulls/30/merge", () =>
      json({ merged: true }),
    );
    await (await github(net)).merge(9, "Dennis-Otto/demo", 30, "abc");
    expect(net.github("/pulls/30/merge")[0]?.body).toEqual({
      merge_method: "squash",
      sha: "abc",
    });
    expect(net.github("/access_tokens")[0]?.body.permissions).toEqual({
      contents: "write",
    });
  });

  it("reads the required checks of the rulesets, for ten minutes", async () => {
    const net = new Net().on(
      "GET",
      "/repos/Dennis-Otto/demo/rules/branches/main",
      () =>
        json([
          { type: "pull_request" },
          {
            type: "required_status_checks",
            parameters: { required_status_checks: [{ context: "lint" }, {}] },
          },
          { type: "required_status_checks" },
        ]),
    );
    const api = await github(net);
    expect(await api.requiredChecks(9, "Dennis-Otto/demo", "main")).toEqual([
      "lint",
    ]);
    expect(await api.requiredChecks(9, "Dennis-Otto/demo", "main")).toEqual([
      "lint",
    ]);
    expect(net.github("/rules/branches/main")).toHaveLength(1);
  });

  it("sends an event to a repository and says why GitHub refused one", async () => {
    const net = new Net().on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    await (await github(net)).dispatch(77, "Dennis-Otto/control", "pager-fix", {
      item: "i",
    });
    expect(net.github("/dispatches")[0]?.body).toEqual({
      event_type: "pager-fix",
      client_payload: { item: "i" },
    });
    const refused = new Net().on(
      "POST",
      /dispatches$/,
      () => new Response("not json", { status: 403 }),
    );
    await expect(
      (await github(refused)).dispatch(77, "Dennis-Otto/control", "x", {}),
    ).rejects.toThrow("GitHub answered 403: not json");
    const nameless = new Net().on("POST", /dispatches$/, () => json({}, 422));
    await expect(
      (await github(nameless)).dispatch(77, "Dennis-Otto/control", "x", {}),
    ).rejects.toThrow("GitHub answered 422: {}");
  });

  it("acts in the maintainer's name only with their token", async () => {
    const net = new Net()
      .on("POST", "/repos/Dennis-Otto/demo/issues/12/comments", () =>
        json({ html_url: "https://github.com/c" }, 201),
      )
      .on(
        "POST",
        "/actions/workflows/issue-assistant.yml/dispatches",
        () => new Response(null, { status: 204 }),
      );
    const api = await github(net);
    expect(await api.comment("Dennis-Otto/demo", 12, "Thanks!")).toBe(
      "https://github.com/c",
    );
    const comment = net.calls.find((call) => call.url.endsWith("/comments"));
    expect(comment?.body).toEqual({ body: "Thanks!" });
    await api.issueAssistant("Dennis-Otto/demo", 12);
    const dispatch = net.github("/issue-assistant.yml/dispatches")[0];
    expect(dispatch?.body).toEqual({
      ref: "main",
      inputs: {
        issue: "12",
        mode: "triage",
        override: "true",
        dry_run: "false",
      },
    });
    expect(net.github("/access_tokens")).toHaveLength(0);

    const without = await github(net, null);
    await expect(without.comment("Dennis-Otto/demo", 12, "x")).rejects.toThrow(
      "GITHUB_USER_TOKEN isn't set",
    );
    const old = new Net().on("POST", /issue-assistant\.yml\/dispatches$/, () =>
      json({ message: "Unexpected inputs provided" }, 422),
    );
    const error = await (await github(old))
      .issueAssistant("Dennis-Otto/demo", 12)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({
      status: 422,
      detail: "Unexpected inputs provided",
    });
  });

  it("sends the headers of the REST API", async () => {
    const net = new Net();
    const headers: Record<string, string>[] = [];
    const recording = new Net();
    recording.fetch = async (input, init) => {
      headers.push(init?.headers as Record<string, string>);
      return net.fetch(input, init);
    };
    await new GitHub(
      "1",
      (await appKey()).pem,
      null,
      recording.fetch,
      () => START,
    ).token(9, "Dennis-Otto/demo", { metadata: "read" });
    expect(headers[0]).toMatchObject({
      accept: "application/vnd.github+json",
      "user-agent": "dennis-otto-pager",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    });
    expect(headers[0]?.authorization).toMatch(/^Bearer ey/);
  });
});

describe("Telegram", () => {
  const telegram = (net: Net) => new Telegram("123:test", 4242, net.fetch);

  it("sends a message with buttons to the one chat, without a preview", async () => {
    const net = new Net();
    const keyboard = [[{ text: "OK", callback_data: "x" }]];
    expect(await telegram(net).send("<b>Hi</b>", keyboard)).toBe(100);
    expect(net.telegram("sendMessage")[0]?.body).toEqual({
      chat_id: 4242,
      text: "<b>Hi</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  it("sends into a thread, and into the main view when Telegram doesn't find it", async () => {
    const net = new Net();
    expect(await telegram(net).send("Hi", [], 77)).toBe(100);
    expect(net.telegram("sendMessage")[0]?.body.message_thread_id).toBe(77);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let tries = 0;
    const gone = new Net().on("POST", /sendMessage$/, () =>
      tries++ === 0
        ? json(
            { ok: false, description: "Bad Request: message thread not found" },
            400,
          )
        : json({ ok: true, result: { message_id: 7 } }),
    );
    expect(await telegram(gone).send("Hi", [], 77)).toBe(7);
    const [first, second] = gone.telegram("sendMessage").map((c) => c.body);
    expect(first.message_thread_id).toBe(77);
    expect(second).not.toHaveProperty("message_thread_id");
    expect(second.text).toBe("Hi");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("passes on every other error of a message for a thread", async () => {
    const busy = new Net().on("POST", /sendMessage$/, () =>
      json({ ok: false, description: "Too Many Requests" }, 429),
    );
    await expect(telegram(busy).send("Hi", [], 77)).rejects.toThrow(
      "Telegram sendMessage: Too Many Requests",
    );
    expect(busy.telegram("sendMessage")).toHaveLength(1);
    const broken = new Net().on("POST", /sendMessage$/, () => {
      throw new TypeError("network");
    });
    await expect(telegram(broken).send("Hi", [], 77)).rejects.toThrow(
      "network",
    );
    expect(broken.telegram("sendMessage")).toHaveLength(1);
  });

  it("takes the thread of a message, with General and a wrong id as none", () => {
    expect(threadOf({ message_thread_id: 77 })).toBe(77);
    expect(threadOf({ message_thread_id: 2 })).toBe(2);
    for (const thread of [undefined, 1, 0, -5, 1.5, "77", null, 2 ** 53]) {
      expect(
        threadOf({ message_thread_id: thread }),
        String(thread),
      ).toBeNull();
    }
    expect(threadOf({})).toBeNull();
  });

  it("edits in place, takes an unchanged message as done and a gone one as gone", async () => {
    const net = new Net();
    expect(await telegram(net).edit(5, "t", [])).toBe(true);
    const unchanged = new Net().on("POST", /editMessageText$/, () =>
      json(
        { ok: false, description: "Bad Request: message is not modified" },
        400,
      ),
    );
    expect(await telegram(unchanged).edit(5, "t", [])).toBe(true);
    const gone = new Net().on("POST", /editMessageText$/, () =>
      json(
        { ok: false, description: "Bad Request: message to edit not found" },
        400,
      ),
    );
    expect(await telegram(gone).edit(5, "t", [])).toBe(false);
    const other = new Net().on("POST", /editMessageText$/, () =>
      json({ ok: false, description: "Too Many Requests" }, 429),
    );
    await expect(telegram(other).edit(5, "t", [])).rejects.toThrow(
      "Telegram editMessageText: Too Many Requests",
    );
    const broken = new Net().on("POST", /editMessageText$/, () => {
      throw new TypeError("network");
    });
    await expect(telegram(broken).edit(5, "t", [])).rejects.toThrow("network");
  });

  it("names an answer without JSON by its status, never by its address", async () => {
    const net = new Net().on(
      "POST",
      /sendMessage$/,
      () => new Response("oops", { status: 502 }),
    );
    const error = await telegram(net)
      .send("x", [])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TelegramError);
    expect(String(error)).toBe("Error: Telegram sendMessage: HTTP 502");
    expect(String(error)).not.toContain("123:test");
    const silent = new Net().on("POST", /sendMessage$/, () =>
      json({ ok: false }, 401),
    );
    await expect(telegram(silent).send("x", [])).rejects.toThrow("HTTP 401");
  });

  it("deletes, answers, prompts, says and reacts", async () => {
    const net = new Net();
    const api = telegram(net);
    await api.remove(5);
    await api.answer("q", "x".repeat(300), true);
    expect(await api.prompt("Write", "Reply")).toBe(100);
    await api.say("Hello");
    await api.react(9, "👀");
    expect(net.telegram("deleteMessage")[0]?.body).toEqual({
      chat_id: 4242,
      message_id: 5,
    });
    expect(net.telegram("answerCallbackQuery")[0]?.body).toEqual({
      callback_query_id: "q",
      text: "x".repeat(200),
      show_alert: true,
    });
    expect(net.telegram("sendMessage")[0]?.body.reply_markup).toEqual({
      force_reply: true,
      input_field_placeholder: "Reply",
    });
    expect(net.telegram("sendMessage")[1]?.body.reply_markup).toEqual({
      inline_keyboard: [],
    });
    expect(net.telegram("setMessageReaction")[0]?.body).toEqual({
      chat_id: 4242,
      message_id: 9,
      reaction: [{ type: "emoji", emoji: "👀" }],
    });
    await api.answer("q", "short");
    expect(net.telegram("answerCallbackQuery")[1]?.body.show_alert).toBe(false);
  });

  it("takes a message that is gone already as deleted, but not a broken network", async () => {
    const gone = new Net().on("POST", /deleteMessage$/, () =>
      json({ ok: false, description: "message to delete not found" }, 400),
    );
    await telegram(gone).remove(5);
    const broken = new Net().on("POST", /deleteMessage$/, () => {
      throw new TypeError("network");
    });
    await expect(telegram(broken).remove(5)).rejects.toThrow("network");
  });

  it("passes over a reaction on a message that is gone, but not a broken network", async () => {
    const gone = new Net().on("POST", /setMessageReaction$/, () =>
      json({ ok: false, description: "Bad Request: message not found" }, 400),
    );
    await telegram(gone).react(9, "👍");
    expect(gone.telegram("setMessageReaction")).toHaveLength(1);
    const broken = new Net().on("POST", /setMessageReaction$/, () => {
      throw new TypeError("network");
    });
    await expect(telegram(broken).react(9, "😢")).rejects.toThrow("network");
  });

  it("reacts only with emojis that Telegram allows a bot", () => {
    // The emojis of ReactionTypeEmoji in the Bot API 10.3 of 2026-08-24: Telegram
    // refuses a reaction of a bot with any other.
    const allowed = new Set(
      "❤ 👍 👎 🔥 🥰 👏 😁 🤔 🤯 😱 🤬 😢 🎉 🤩 🤮 💩 🙏 👌 🕊 🤡 🥱 🥴 😍 🐳 ❤‍🔥 🌚 🌭 💯 🤣 ⚡ 🍌 🏆 💔 🤨 😐 🍓 🍾 💋 🖕 😈 😴 😭 🤓 👻 👨‍💻 👀 🎃 🙈 😇 😨 🤝 ✍ 🤗 🫡 🎅 🎄 ☃ 💅 🤪 🗿 🆒 💘 🙉 🦄 😘 💊 🙊 😎 👾 🤷‍♂ 🤷 🤷‍♀ 😡".split(
        " ",
      ),
    );
    expect(allowed.size).toBe(73);
    expect(allowed.has("✅")).toBe(false);
    for (const emoji of Object.values(REACTIONS)) {
      expect(allowed.has(emoji), emoji).toBe(true);
    }
  });

  it("takes the buttons off a message, and passes over one that is gone", async () => {
    const net = new Net();
    await telegram(net).clear(8);
    expect(net.telegram("editMessageReplyMarkup")[0]?.body).toEqual({
      chat_id: 4242,
      message_id: 8,
      reply_markup: { inline_keyboard: [] },
    });
    const gone = new Net().on("POST", /editMessageReplyMarkup$/, () =>
      json({ ok: false, description: "message to edit not found" }, 400),
    );
    await telegram(gone).clear(8);
    const broken = new Net().on("POST", /editMessageReplyMarkup$/, () => {
      throw new TypeError("network");
    });
    await expect(telegram(broken).clear(8)).rejects.toThrow("network");
  });
});
