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
  MAX_RETRY_AFTER,
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

  it("signs one JWT for the calls of seven minutes, and a new one after", async () => {
    const net = new Net().on("GET", /installation$/, () => json({ id: 77 }));
    const clock = { now: START };
    const api = new GitHub(
      "12345",
      (await appKey()).pem,
      null,
      net.fetch,
      () => clock.now,
    );
    await api.installation("Dennis-Otto/control");
    clock.now = START + 7 * 60_000 - 1;
    await api.installation("Dennis-Otto/control");
    clock.now = START + 7 * 60_000;
    await api.installation("Dennis-Otto/control");
    const [first, second, third] = net.calls.map(
      (call) => call.headers.authorization,
    );
    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(third).toMatch(/^Bearer ey/);
  });

  it("lists the deliveries of its webhook page by page, and delivers one again", async () => {
    const next =
      '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=v1_9%2B1>; rel="next"';
    const net = new Net()
      .on("GET", "/app/hook/deliveries?per_page=100", () =>
        Response.json([{ id: 2, guid: "g" }], { headers: { link: next } }),
      )
      .on("GET", "/app/hook/deliveries?per_page=100&cursor=v1_9%2B1", () =>
        json([{ id: 1, guid: "g" }]),
      )
      .on("POST", "/app/hook/deliveries/2/attempts", () => json({}, 202))
      .on("POST", "/app/hook/deliveries/1/attempts", () =>
        json({ message: "Validation Failed" }, 422),
      );
    const api = await github(net);
    expect(await api.deliveries(null)).toEqual({
      deliveries: [{ id: 2, guid: "g" }],
      cursor: "v1_9+1",
    });
    expect(await api.deliveries("v1_9+1")).toEqual({
      deliveries: [{ id: 1, guid: "g" }],
      cursor: null,
    });
    await api.redeliver(2);
    await expect(api.redeliver(1)).rejects.toThrow(
      "GitHub answered 422: Validation Failed",
    );
    expect(net.calls.map((call) => call.headers.authorization)).toEqual(
      Array(4).fill(net.calls[0]?.headers.authorization),
    );
  });

  it("names the page of its settings, under its owner", async () => {
    const owners = [
      [{ login: "Dennis-Otto", type: "User" }, "https://github.com/settings"],
      [
        { login: "acme", type: "Organization" },
        "https://github.com/organizations/acme/settings",
      ],
      [null, "https://github.com/settings"],
    ] as const;
    for (const [owner, settings] of owners) {
      const net = new Net().on("GET", "/app", () =>
        json({ slug: "pager", owner }),
      );
      expect(await (await github(net)).appSettings()).toBe(
        `${settings}/apps/pager`,
      );
    }
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

  it("lists the jobs of an attempt of a run, with what GitHub names of each", async () => {
    const jobs =
      "/repos/Dennis-Otto/demo/actions/runs/60/attempts/2/jobs?per_page=100";
    const net = new Net().on("GET", jobs, () =>
      json({
        jobs: [
          {
            name: "build",
            html_url: "https://github.com/j/1",
            conclusion: "failure",
          },
          {
            name: "running",
            html_url: "https://github.com/j/2",
            conclusion: null,
          },
          { name: "nowhere" },
          { html_url: "https://github.com/j/4" },
        ],
      }),
    );
    const api = await github(net);
    expect(await api.jobs(9, "Dennis-Otto/demo", 60, 2)).toEqual([
      { name: "build", url: "https://github.com/j/1", conclusion: "failure" },
      { name: "running", url: "https://github.com/j/2", conclusion: "" },
    ]);
    expect(net.github("/access_tokens")[0]?.body.permissions).toEqual({
      actions: "read",
    });
    // An answer without its list lists none.
    net.on("GET", jobs, () => json({}));
    expect(await api.jobs(9, "Dennis-Otto/demo", 60, 2)).toEqual([]);
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

  it("replies in a discussion as the app, in the thread of the comment that it answers", async () => {
    // The answers of GitHub, one per call to its GraphQL API, in their order.
    function graphql(...answers: unknown[]): Net {
      return new Net().on("POST", "/graphql", () => json(answers.shift()));
    }
    const added = {
      data: { addDiscussionComment: { comment: { id: "DC_9" } } },
    };
    const net = graphql({ data: { node: { replyTo: { id: "DC_1" } } } }, added);
    const api = await github(net, null);
    await api.reply(
      9,
      "Dennis-Otto/demo",
      { node: "D_1", comment: "DC_2" },
      "Thanks!",
    );
    const [thread, reply] = net.github("/graphql");
    expect(thread?.body.variables).toEqual({ comment: "DC_2" });
    expect(thread?.body.query).toContain("replyTo { id }");
    // A reply to a reply goes into the thread of its parent.
    expect(reply?.body.variables).toEqual({
      discussion: "D_1",
      replyTo: "DC_1",
      body: "Thanks!",
    });
    expect(reply?.body.query).toContain("addDiscussionComment");
    expect(net.github("/access_tokens")[0]?.body).toEqual({
      repositories: ["demo"],
      permissions: { discussions: "write" },
    });

    // A comment of the discussion itself is the start of its thread.
    const top = graphql({ data: { node: { replyTo: null } } }, added);
    await (await github(top)).reply(
      9,
      "Dennis-Otto/demo",
      { node: "D_1", comment: "DC_2" },
      "Thanks!",
    );
    expect(top.github("/graphql")[1]?.body.variables.replyTo).toBe("DC_2");
    // A comment that is gone: GitHub answers NOT_FOUND next to no node, and the
    // approved reply goes on the discussion itself rather than being lost.
    const notFound = {
      type: "NOT_FOUND",
      message: "Could not resolve to a node with the global id of 'DC_2'",
    };
    const gone = graphql({ data: { node: null }, errors: [notFound] }, added);
    await (await github(gone)).reply(
      9,
      "Dennis-Otto/demo",
      { node: "D_1", comment: "DC_2" },
      "Thanks!",
    );
    expect(gone.github("/graphql")[1]?.body.variables.replyTo).toBeNull();
    // NOT_FOUND without data, or of the reply itself, still refuses.
    const empty = graphql({ errors: [notFound] });
    await expect(
      (await github(empty)).reply(
        9,
        "Dennis-Otto/demo",
        { node: "D_1", comment: "DC_2" },
        "Thanks!",
      ),
    ).rejects.toThrow("Could not resolve");
    const lost = graphql({
      data: { addDiscussionComment: null },
      errors: [notFound],
    });
    await expect(
      (await github(lost)).reply(9, "Dennis-Otto/demo", { node: "D_1" }, "x"),
    ).rejects.toThrow("Could not resolve");

    // The discussion itself takes the reply as a comment of its own.
    const own = graphql(added);
    await (await github(own)).reply(
      9,
      "Dennis-Otto/demo",
      { node: "D_1" },
      "Thanks!",
    );
    expect(own.github("/graphql")).toHaveLength(1);
    expect(own.github("/graphql")[0]?.body.variables.replyTo).toBeNull();
  });

  it("says why the GraphQL API refused, from the first of its errors", async () => {
    const refused = new Net().on("POST", "/graphql", () =>
      json({
        errors: [{ message: "Resource not accessible by integration" }, {}],
      }),
    );
    const error = await (await github(refused))
      .reply(9, "Dennis-Otto/demo", { node: "D_1" }, "Thanks!")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({
      detail: "Resource not accessible by integration",
    });
    const nameless = new Net().on("POST", "/graphql", () =>
      json({ errors: [{}] }),
    );
    await expect(
      (await github(nameless)).reply(
        9,
        "Dennis-Otto/demo",
        { node: "D_1" },
        "x",
      ),
    ).rejects.toThrow("the GraphQL API refused");
    const down = new Net().on("POST", "/graphql", () =>
      json({ message: "Bad credentials" }, 401),
    );
    await expect(
      (await github(down)).reply(9, "Dennis-Otto/demo", { node: "D_1" }, "x"),
    ).rejects.toThrow("GitHub answered 401: Bad credentials");
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
      "user-agent": "repo-pager",
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

  it("waits once when Telegram asks for a short wait, and tries again", async () => {
    const waits: number[] = [];
    let tries = 0;
    const busy = new Net().on("POST", /sendMessage$/, () =>
      tries++ === 0
        ? json(
            {
              ok: false,
              error_code: 429,
              description: "Too Many Requests: retry after 2",
              parameters: { retry_after: 2 },
            },
            429,
          )
        : json({ ok: true, result: { message_id: 8 } }),
    );
    const patient = new Telegram("123:test", 4242, busy.fetch, async (s) => {
      waits.push(s);
    });
    expect(await patient.send("Hi", [])).toBe(8);
    expect(waits).toEqual([2]);
    expect(busy.telegram("sendMessage")).toHaveLength(2);
  });

  it("waits no longer than MAX_RETRY_AFTER, and only once", async () => {
    const limited = (after: number) =>
      new Net().on("POST", /sendMessage$/, () =>
        json(
          {
            ok: false,
            error_code: 429,
            description: "Too Many Requests",
            parameters: { retry_after: after },
          },
          429,
        ),
      );
    const waits: number[] = [];
    const record = async (s: number) => {
      waits.push(s);
    };
    const long = limited(MAX_RETRY_AFTER + 1);
    await expect(
      new Telegram("123:test", 4242, long.fetch, record).send("Hi", []),
    ).rejects.toThrow("Too Many Requests");
    expect(long.telegram("sendMessage")).toHaveLength(1);
    const again = limited(1);
    await expect(
      new Telegram("123:test", 4242, again.fetch, record).send("Hi", []),
    ).rejects.toThrow("Too Many Requests");
    expect(again.telegram("sendMessage")).toHaveLength(2);
    expect(waits).toEqual([1]);
  });

  it("waits for real by default", async () => {
    vi.useFakeTimers();
    try {
      let tries = 0;
      const busy = new Net().on("POST", /sendMessage$/, () =>
        tries++ === 0
          ? json(
              { ok: false, error_code: 429, parameters: { retry_after: 1 } },
              429,
            )
          : json({ ok: true, result: { message_id: 9 } }),
      );
      const sent = telegram(busy).send("Hi", []);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await sent).toBe(9);
    } finally {
      vi.useRealTimers();
    }
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
