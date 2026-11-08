// The tokens of the maintainer that expire: GITHUB_USER_TOKEN, whose day the schedule
// reads from GitHub once a day, PAGER_FIX_TOKEN, whose day the control repository
// names, and the reminder of each three weeks before; and the answer of ✅ Send and
// 🤖 Assistant again when GitHub refuses the token.
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeContext } from "../src/context.ts";
import { handleControl } from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import type { Context } from "../src/pager.ts";
import { runSchedule } from "../src/schedule.ts";
import type { PagerEnv, Settings } from "../src/settings.ts";
import {
  type Contribution,
  type Item,
  itemId,
  keys,
  type Reminder,
} from "../src/store.ts";
import {
  dayOf,
  expiryOf,
  readTokens,
  TOKENS,
  type Tokens,
  tokensOf,
} from "../src/tokens.ts";
import { handleUpdate } from "../src/updates.ts";
import {
  base,
  CHAT,
  DELIVERIES,
  json,
  RATE_LIMIT,
  START,
  settings,
  type World,
  withTopics,
  world,
} from "./helpers.ts";

const DAY = 24 * 60 * 60 * 1000;
const HEADER = "github-authentication-token-expiration";

/** GitHub's answer to GET /rate_limit, with the day of the token in its header, if any. */
function limits(expires?: string): () => Response {
  return () =>
    new Response(JSON.stringify({ resources: {} }), {
      headers: {
        "content-type": "application/json",
        ...(expires === undefined ? {} : { [HEADER]: expires }),
      },
    });
}

function checks(w: World): number {
  return w.net.calls.filter((call) => call.url === RATE_LIMIT).length;
}

/** The same pager with other settings, such as a new token: the same storage and network. */
async function withSettings(
  w: World,
  overrides: Partial<Settings>,
): Promise<Context> {
  return makeContext(
    await settings(overrides),
    env as PagerEnv,
    w.net.fetch,
    () => w.clock.now,
    async () => {},
    undefined,
    w.context.local,
  );
}

async function reminder(name: string): Promise<string> {
  return itemId(keys.reminder(name));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the day on which a token expires", () => {
  it("is the day in UTC of the header of GitHub, in each form that it takes", () => {
    expect(expiryOf("2026-12-03 10:00:00 UTC")).toBe("2026-12-03");
    expect(expiryOf(" 2026-12-03 10:00:00 ")).toBe("2026-12-03");
    expect(expiryOf("2026-12-03T10:00:00Z")).toBe("2026-12-03");
    expect(expiryOf("2026-12-03 20:00:00 -0800")).toBe("2026-12-04");
    expect(expiryOf("2026-12-03 01:00:00 +02:00")).toBe("2026-12-02");
  });

  it("is none without the header, or for one that the pager can't read", () => {
    expect(expiryOf(null)).toBeNull();
    expect(expiryOf("")).toBeNull();
    expect(expiryOf("next week")).toBeNull();
    expect(expiryOf("2026-13-45 10:00:00 UTC")).toBeNull();
  });

  it("comes from a body of the control repository as a day, or null for none", () => {
    expect(tokensOf({ fix: "2026-12-03" })).toEqual({ fix: "2026-12-03" });
    expect(tokensOf({ fix: null })).toEqual({ fix: null });
    expect(tokensOf({ fix: "2026-12-03T10:00:00Z" })).toBeUndefined();
    expect(tokensOf({ fix: "2026-13-01" })).toBeUndefined();
    expect(tokensOf({ fix: 3 })).toBeUndefined();
    expect(tokensOf({ other: "2026-12-03" })).toBeUndefined();
    expect(tokensOf(null)).toBeUndefined();
    expect(tokensOf(undefined)).toBeUndefined();
    expect(dayOf(START)).toBe("2026-11-04");
  });
});

describe("GITHUB_USER_TOKEN", () => {
  it("is checked once a day, and reminds three weeks before its day, once", async () => {
    const w = await world();
    withTopics(w.net);
    w.net.on("GET", "/rate_limit", limits("2026-12-03 10:00:00 UTC"));
    // 29 days before: no reminder yet.
    expect(await runSchedule(w.context)).toEqual([]);
    expect(checks(w)).toBe(1);
    expect(
      w.net.calls.find((call) => call.url === RATE_LIMIT)?.headers,
    ).toMatchObject({
      authorization: "Bearer user-token",
    });
    expect((await readTokens(w.context)).user).toEqual({
      expires: "2026-12-03",
    });
    w.clock.now = START + 12 * 60 * 60 * 1000;
    expect(await runSchedule(w.context)).toEqual([]);
    expect(checks(w)).toBe(1);

    w.clock.now = Date.parse("2026-11-12T08:00:00Z");
    const id = await reminder("user-token:2026-12-03");
    expect(await runSchedule(w.context)).toEqual([id]);
    expect(checks(w)).toBe(2);
    expect(w.net.telegram("createForumTopic")[0]?.body.name).toBe(
      "🔔 GitHub token of the pager",
    );
    const text = w.net.telegram("sendMessage")[0]?.body.text;
    expect(text).toContain(
      "GITHUB_USER_TOKEN, expires in 21 days, on 2026-12-03",
    );
    expect(text).toContain("npx wrangler secret put GITHUB_USER_TOKEN");
    expect(text).not.toContain("user-token");
    expect(await w.context.store.get(id)).toMatchObject({
      kind: "reminder",
      token: "user",
      state: "open",
    });
    w.clock.now += DAY;
    expect(await runSchedule(w.context)).toEqual([]);
    expect(checks(w)).toBe(3);
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
  });

  it("says when its day has passed", async () => {
    const w = await world();
    w.net.on("GET", "/rate_limit", limits("2026-11-01 10:00:00 UTC"));
    const id = await reminder("user-token:2026-11-01");
    expect(await runSchedule(w.context)).toEqual([id]);
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "GITHUB_USER_TOKEN, expires on 2026-11-01: it has expired",
    );
  });

  it("reminds of nothing without the header, a token without a day", async () => {
    const w = await world();
    expect(await runSchedule(w.context)).toEqual([]);
    expect((await readTokens(w.context)).user).toEqual({ expires: null });
    expect(w.net.telegram("sendMessage")).toHaveLength(0);
  });

  it("reminds once while GitHub refuses it, and asks about a new token at once", async () => {
    const w = await world();
    w.net.on("GET", "/rate_limit", () =>
      json({ message: "Bad credentials" }, 401),
    );
    const id = await reminder("user-token:refused:2026-11-04");
    expect(await runSchedule(w.context)).toEqual([id]);
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "GitHub refuses the token of the pager, GITHUB_USER_TOKEN: it expired or was revoked",
    );
    w.clock.now += DAY;
    expect(await runSchedule(w.context)).toEqual([]);
    expect(checks(w)).toBe(2);
    expect((await readTokens(w.context)).user).toEqual({
      expires: null,
      refused: "2026-11-04",
    });

    // A new token, set the same day: asked about at once, and it passes.
    const renewed = await withSettings(w, { userToken: "new-token" });
    w.net.on("GET", "/rate_limit", limits("2027-02-01 10:00:00 UTC"));
    expect(await runSchedule(renewed)).toEqual([]);
    expect(checks(w)).toBe(3);
    expect((await readTokens(w.context)).user).toEqual({
      expires: "2027-02-01",
    });

    // Refused later, after its day was known: the day stays, the refusal is new.
    w.clock.now += DAY;
    w.net.on("GET", "/rate_limit", () =>
      json({ message: "Bad credentials" }, 401),
    );
    const again = await reminder("user-token:refused:2026-11-06");
    expect(await runSchedule(renewed)).toEqual([again]);
    expect((await readTokens(w.context)).user).toEqual({
      expires: "2027-02-01",
      refused: "2026-11-06",
    });
  });

  it("is asked about again on the next run when GitHub fails to answer", async () => {
    const w = await world();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
      errors.push(parts.join(" "));
    });
    w.net.on("GET", "/rate_limit", () => json({ message: "Unicorn" }, 503));
    expect(await runSchedule(w.context)).toEqual([]);
    expect(errors).toEqual([
      "The check of GITHUB_USER_TOKEN failed: GitHub answered 503: Unicorn",
    ]);
    expect(await readTokens(w.context)).toEqual({});
    // The rest of the run went on.
    expect(w.net.calls.map((call) => call.url)).toEqual([
      RATE_LIMIT,
      DELIVERIES,
    ]);
    w.net.on("GET", "/rate_limit", limits());
    await runSchedule(w.context);
    expect(checks(w)).toBe(2);
    expect((await readTokens(w.context)).checked?.day).toBe("2026-11-04");
  });

  it("passes on an error that isn't an answer of GitHub", async () => {
    const w = await world();
    w.net.on("GET", "/rate_limit", () => {
      throw new TypeError("Network connection lost");
    });
    await expect(runSchedule(w.context)).rejects.toThrow(TypeError);
  });

  it("isn't asked about without the token, or when the run has no call left", async () => {
    const without = await world({ userToken: null });
    // A day that the pager learned while the token was set doesn't count.
    await without.context.local.put<Tokens>(TOKENS, {
      user: { expires: "2026-11-10" },
    });
    expect(await runSchedule(without.context)).toEqual([]);
    expect(checks(without)).toBe(0);

    const busy = await world();
    const counted = busy.context.subrequests;
    busy.context.subrequests = () => counted() + 50;
    expect(await runSchedule(busy.context)).toEqual([]);
    expect(checks(busy)).toBe(0);
    expect(await readTokens(busy.context)).toEqual({});
  });

  it("reminds in the language of the pager", async () => {
    const w = await world({ language: "de" });
    withTopics(w.net);
    w.net.on("GET", "/rate_limit", limits("2026-11-25 10:00:00 UTC"));
    await runSchedule(w.context);
    expect(w.net.telegram("createForumTopic")[0]?.body.name).toBe(
      "🔔 GitHub-Token des Pagers",
    );
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "GITHUB_USER_TOKEN, läuft in 21 Tagen ab, am 25.11.2026",
    );
  });
});

describe("a button that acts in the maintainer's name", () => {
  const drafted: Contribution = {
    ...base("i0123456789abcde"),
    kind: "contribution",
    state: "draft",
    number: 12,
    pull: false,
    title: "It breaks",
    url: "https://github.com/Dennis-Otto/demo/issues/12",
    author: "octocat",
    draft: "Thanks!",
    draftVersion: 2,
  };

  async function press(w: World, item: Item, data: string) {
    await w.context.store.put(item);
    await handleUpdate(w.context, {
      callback_query: { id: "q1", from: { id: CHAT }, data },
    });
    return {
      answer: w.net.telegram("answerCallbackQuery").at(-1)?.body,
      item: await w.context.store.get(item.id),
    };
  }

  it("says that GitHub refuses the token when it answers 401", async () => {
    const w = await world();
    w.net
      .on("POST", "/repos/Dennis-Otto/demo/issues/12/comments", () =>
        json({ message: "Bad credentials" }, 401),
      )
      .on("POST", /issue-assistant\.yml\/dispatches$/, () =>
        json({ message: "Bad credentials" }, 401),
      );
    const sent = await press(w, drafted, `send:${drafted.id}:2`);
    expect(sent.answer).toMatchObject({
      text: 'GitHub refuses GITHUB_USER_TOKEN: it expired or was revoked. Make a new one and set it with "npx wrangler secret put GITHUB_USER_TOKEN", as docs/setup.md says.',
      show_alert: true,
    });
    expect(sent.answer.text.length).toBeLessThanOrEqual(200);
    expect(sent.item?.state).toBe("draft");
    const again = await press(
      w,
      { ...drafted, state: "new", draft: null },
      `assistant:${drafted.id}`,
    );
    expect(again.answer.text).toContain("it expired or was revoked");
  });

  it("still names any other refusal of GitHub as it is", async () => {
    const w = await world();
    w.net.on("POST", "/repos/Dennis-Otto/demo/issues/12/comments", () =>
      json(
        { message: "Resource not accessible by personal access token" },
        403,
      ),
    );
    const { answer } = await press(w, drafted, `send:${drafted.id}:2`);
    expect(answer.text).toBe(
      "GitHub refused: Resource not accessible by personal access token",
    );
  });
});

describe("PAGER_FIX_TOKEN", () => {
  async function send(w: World, value: unknown) {
    const body = JSON.stringify(value);
    const stamp = String(START / 1000);
    const response = await handleControl(
      w.context,
      new Request("https://pager.example/control", {
        method: "POST",
        headers: {
          "x-pager-timestamp": stamp,
          "x-pager-signature": `sha256=${await hmacHex("control-secret", `${stamp}.${body}`)}`,
        },
        body,
      }),
    );
    return response.text();
  }

  it("takes its day from any body of the control repository, and reminds three weeks before", async () => {
    const w = await world();
    withTopics(w.net);
    expect(
      await send(w, {
        type: "note",
        text: "Nothing to fix.",
        tokens: { fix: "2026-11-20" },
      }),
    ).toBe("said");
    expect((await readTokens(w.context)).fix).toEqual({
      expires: "2026-11-20",
    });
    const id = await reminder("fix-token:2026-11-20");
    expect(await runSchedule(w.context)).toEqual([id]);
    expect(w.net.telegram("createForumTopic").at(-1)?.body.name).toBe(
      "🔔 Token of 🛠 Start fix",
    );
    expect(w.net.telegram("sendMessage").at(-1)?.body.text).toContain(
      "PAGER_FIX_TOKEN in Dennis-Otto/control expires in 16 days, on 2026-11-20",
    );
    expect(((await w.context.store.get(id)) as Reminder).token).toBe("fix");
    expect(await runSchedule(w.context)).toEqual([]);

    await send(w, {
      type: "note",
      text: "Late.",
      tokens: { fix: "2026-11-01" },
    });
    const expired = await reminder("fix-token:2026-11-01");
    expect(await runSchedule(w.context)).toEqual([expired]);
    expect(w.net.telegram("sendMessage").at(-1)?.body.text).toContain(
      "PAGER_FIX_TOKEN in Dennis-Otto/control expires on 2026-11-01: it has expired",
    );
  });

  it("passes over a day that it can't read, and reminds of none for a token without a day", async () => {
    const w = await world();
    await send(w, { type: "note", text: "A.", tokens: { fix: "2026-11-20" } });
    const put = vi.spyOn(w.context.local, "put");
    expect(
      await send(w, { type: "note", text: "B.", tokens: { fix: "soon" } }),
    ).toBe("said");
    expect(
      await send(w, { type: "note", text: "C.", tokens: "2026-11-20" }),
    ).toBe("said");
    // The same day again writes nothing.
    await send(w, { type: "note", text: "D.", tokens: { fix: "2026-11-20" } });
    expect(put).not.toHaveBeenCalled();
    expect((await readTokens(w.context)).fix).toEqual({
      expires: "2026-11-20",
    });
    await send(w, { type: "note", text: "E.", tokens: { fix: null } });
    expect((await readTokens(w.context)).fix).toEqual({ expires: null });
    const shown = await runSchedule(w.context);
    expect(shown).toEqual([]);
  });

  it("is learned from no body that the pager refuses", async () => {
    const w = await world();
    expect(await send(w, { type: "nope", tokens: { fix: "2026-11-20" } })).toBe(
      "Bad Request",
    );
    expect(await readTokens(w.context)).toEqual({});
  });
});
