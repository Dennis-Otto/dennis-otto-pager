// The answers of the control repository, signed over the time and the body, and the
// schedule: "Later" that is over, and the reminder of the token of Claude.
import { describe, expect, it, vi } from "vitest";

import { headTag } from "../src/buttons.ts";
import { handleControl, WINDOW } from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import { runSchedule } from "../src/schedule.ts";
import {
  type Alarm,
  type Contribution,
  type Item,
  itemId,
  keys,
  type Release,
} from "../src/store.ts";
import { base, REPO, START, type World, world } from "./helpers.ts";

const ID = "i0123456789abcde";

async function request(
  body: string,
  { secret = "control-secret", stamp = String(START / 1000) } = {},
): Promise<Request> {
  return new Request("https://pager.example/control", {
    method: "POST",
    headers: {
      "x-pager-timestamp": stamp,
      "x-pager-signature": `sha256=${await hmacHex(secret, `${stamp}.${body}`)}`,
    },
    body,
  });
}

async function send(w: World, value: unknown, options = {}) {
  const response = await handleControl(
    w.context,
    await request(JSON.stringify(value), options),
  );
  return { status: response.status, text: await response.text() };
}

const contribution: Contribution = {
  ...base(ID),
  kind: "contribution",
  state: "drafting",
  number: 12,
  pull: false,
  title: "It breaks",
  url: "https://github.com/Dennis-Otto/demo/issues/12",
  author: "octocat",
  draft: null,
  draftVersion: 0,
};

describe("the control repository", () => {
  it("needs its secret, a fresh time and a valid signature", async () => {
    const off = await world({ controlSecret: null });
    expect((await send(off, { type: "note", text: "x" })).status).toBe(503);
    const w = await world();
    const note = { type: "note", text: "x" };
    expect((await send(w, note, { secret: "wrong" })).status).toBe(401);
    expect((await send(w, note, { stamp: "soon" })).status).toBe(401);
    expect(
      (await send(w, note, { stamp: String(START / 1000 - WINDOW - 1) }))
        .status,
    ).toBe(401);
    expect(
      (await send(w, note, { stamp: String(START / 1000 + WINDOW) })).status,
    ).toBe(200);
    const unsigned = new Request("https://pager.example/control", {
      method: "POST",
      body: "{}",
    });
    expect((await handleControl(w.context, unsigned)).status).toBe(401);
  });

  it("refuses what isn't a draft or a note", async () => {
    const w = await world();
    for (const value of [
      "not json",
      null,
      { type: "draft", text: "x" },
      { type: "note", text: "  " },
      { type: "note", item: 5, text: "x" },
      { type: "run", text: "rm -rf" },
    ]) {
      const body = typeof value === "string" ? value : JSON.stringify(value);
      const response = await handleControl(w.context, await request(body));
      expect(response.status).toBe(400);
    }
  });

  it("says a note for the chat, escaped", async () => {
    const w = await world();
    expect(await send(w, { type: "note", text: "Fixed in <b>#3</b>" })).toEqual(
      {
        status: 200,
        text: "said",
      },
    );
    expect(w.net.telegram("sendMessage")[0]?.body.text).toBe(
      "🤖 Fixed in &lt;b&gt;#3&lt;/b&gt;",
    );
  });

  it("adds a note to a thing", async () => {
    const w = await world();
    await w.context.store.put({
      ...contribution,
      kind: "alarm",
      state: "fixing",
      entries: [],
    } as Item);
    expect(
      await send(w, { type: "note", item: ID, text: "PR #3 fixes it" }),
    ).toEqual({
      status: 200,
      text: "noted",
    });
    expect(await w.context.store.get(ID)).toMatchObject({
      note: "PR #3 fixes it",
    });
    expect(
      (await send(w, { type: "note", item: "i000000000000000", text: "x" }))
        .status,
    ).toBe(404);
  });

  it("shows a draft as a new message with Send", async () => {
    const w = await world();
    await w.context.store.put(contribution);
    expect(await send(w, { type: "draft", item: ID, text: "Thanks!" })).toEqual(
      {
        status: 200,
        text: "drafted",
      },
    );
    expect(await w.context.store.get(ID)).toMatchObject({
      state: "draft",
      draft: "Thanks!",
      draftVersion: 1,
      messageId: 100,
    });
    expect(w.net.telegram("deleteMessage")[0]?.body.message_id).toBe(7);
    expect(
      (await send(w, { type: "draft", item: ID, text: "x".repeat(3001) }))
        .status,
    ).toBe(413);
    await w.context.store.put({ ...contribution, state: "sent" });
    expect(
      (await send(w, { type: "draft", item: ID, text: "Again" })).status,
    ).toBe(409);
    await w.context.store.put({
      ...contribution,
      kind: "alarm",
      state: "open",
      entries: [],
    } as Item);
    expect(
      (await send(w, { type: "draft", item: ID, text: "Again" })).status,
    ).toBe(409);
  });
});

describe("the answers of Claude", () => {
  const usage = { turns: 3, seconds: 41 };

  it("refuses a wrong usage and a proposal outside the allowlist", async () => {
    const w = await world();
    const proposal = (action: unknown, target: unknown) => ({
      type: "proposal",
      text: "Shall I?",
      action,
      target,
    });
    for (const value of [
      5,
      { type: "note", text: "x", usage: null },
      { type: "note", text: "x", usage: "many" },
      { type: "note", text: "x", usage: { turns: -1, seconds: 2 } },
      { type: "note", text: "x", usage: { turns: 1, seconds: 0.5 } },
      { type: "failed", text: "x" },
      proposal("send", { kind: "contribution", repo: REPO, number: 1 }),
      proposal("edit", { kind: "contribution", repo: REPO, number: 1 }),
      proposal(5, { kind: "release", repo: REPO }),
      proposal("constructor", { kind: "release", repo: REPO }),
      proposal("__proto__", { kind: "release", repo: REPO }),
      proposal("toString", { kind: "release", repo: REPO }),
      proposal("merge", { kind: "contribution", repo: REPO, number: 1 }),
      proposal("merge", { kind: "release", repo: "not a repo" }),
      proposal("merge", { kind: "release", repo: 7 }),
      proposal("merge", { kind: "release", repo: REPO, number: 3 }),
      proposal("merge", undefined),
      proposal("draft", { kind: "contribution", repo: REPO }),
      proposal("draft", { kind: "contribution", repo: REPO, number: 0 }),
    ]) {
      expect((await send(w, value)).status, JSON.stringify(value)).toBe(400);
    }
    expect(w.net.calls).toHaveLength(0);
  });

  it("says an answer with what it took from the weekly limit", async () => {
    const w = await world();
    await send(w, { type: "note", text: "All green.", usage });
    await send(w, {
      type: "note",
      text: "Once.",
      usage: { turns: 1, seconds: 9 },
    });
    const texts = w.net.telegram("sendMessage").map((call) => call.body.text);
    expect(texts).toEqual([
      "🤖 All green.\n\n<i>🧮 Claude: 3 turns, 41 s, from your weekly limit</i>",
      "🤖 Once.\n\n<i>🧮 Claude: 1 turn, 9 s, from your weekly limit</i>",
    ]);
  });

  it("proposes an action of the allowlist with one Confirm button", async () => {
    const w = await world();
    const release: Release = {
      ...base(await itemId(keys.release(REPO))),
      kind: "release",
      state: "ready",
      number: 30,
      version: "1.2.3",
      sha: "abc",
      url: `https://github.com/${REPO}/pull/30`,
    };
    const issue: Contribution = {
      ...contribution,
      id: await itemId(keys.contribution(REPO, 12)),
      state: "new",
    };
    const alarm: Alarm = {
      ...base(await itemId(keys.alarm(REPO))),
      kind: "alarm",
      state: "open",
      entries: [],
    };
    const alert: Item = {
      ...alarm,
      id: await itemId(keys.alert(REPO)),
      kind: "alert",
      state: "open",
    };
    for (const item of [release, issue, alarm, alert]) {
      await w.context.store.put(item);
    }
    const proposals = [
      { action: "merge", target: { kind: "release", repo: REPO } },
      {
        action: "assistant",
        target: { kind: "contribution", repo: REPO, number: 12 },
      },
      { action: "fix", target: { kind: "alarm", repo: REPO } },
      { action: "fix", target: { kind: "alert", repo: REPO } },
    ];
    for (const proposal of proposals) {
      expect(
        await send(w, {
          type: "proposal",
          text: "Its checks are <green>.",
          ...proposal,
          usage,
        }),
      ).toEqual({ status: 200, text: "proposed" });
    }
    const sent = w.net.telegram("sendMessage").map((call) => call.body);
    expect(sent[0]?.text).toBe(
      [
        "🤖 Its checks are &lt;green&gt;.",
        `👉 🔀 Merge 1.2.3: <a href="https://github.com/${REPO}/pull/30">${REPO}#30</a>`,
        "<i>🧮 Claude: 3 turns, 41 s, from your weekly limit</i>",
      ].join("\n\n"),
    );
    expect(sent.map((body) => body.reply_markup.inline_keyboard)).toEqual([
      [
        [
          {
            text: "✅ Confirm",
            callback_data: `merge:${release.id}:${headTag("abc")}`,
          },
        ],
      ],
      [[{ text: "✅ Confirm", callback_data: `assistant:${issue.id}` }]],
      [[{ text: "✅ Confirm", callback_data: `fix:${alarm.id}` }]],
      [[{ text: "✅ Confirm", callback_data: `fix:${alert.id}` }]],
    ]);
    expect(sent[1]?.text).toContain(`>${REPO}#12</a>`);
    expect(sent[2]?.text).toContain(`/${REPO}/actions">${REPO}</a>`);
    expect(sent[3]?.text).toContain(`>code scanning of ${REPO}</a>`);
    // A proposal changes no thing: only the press of its button does.
    expect(await w.context.store.get(release.id)).toEqual(release);
  });

  it("shows a proposal without a button when its thing is gone or doesn't offer it", async () => {
    const w = await world();
    const target = { kind: "release", repo: REPO };
    const merge = { type: "proposal", text: "Merge?", action: "merge", target };
    expect(await send(w, merge)).toEqual({ status: 200, text: "said" });
    await w.context.store.put({
      ...base(await itemId(keys.release(REPO))),
      kind: "release",
      state: "merging",
      number: 30,
      version: "1.2.3",
      sha: "abc",
      url: `https://github.com/${REPO}/pull/30`,
    });
    expect(await send(w, merge)).toEqual({ status: 200, text: "said" });
    const sent = w.net.telegram("sendMessage").map((call) => call.body);
    expect(sent[0]?.text).toBe(
      `🤖 Merge?\n\n<i>No button: the pager shows no release of ${REPO} for 🔀 Merge.</i>`,
    );
    expect(sent[1]?.text).toContain("doesn't offer 🔀 Merge now.");
    expect(sent.map((body) => body.reply_markup.inline_keyboard)).toEqual([
      [],
      [],
    ]);
  });

  it("brings a thing back when its job failed, so that its button works again", async () => {
    const w = await world();
    await w.context.store.put(contribution);
    expect(
      await send(w, {
        type: "failed",
        item: ID,
        text: "No draft: the weekly limit is reached.",
        usage,
      }),
    ).toEqual({ status: 200, text: "reopened" });
    expect(await w.context.store.get(ID)).toMatchObject({
      state: "new",
      messageId: 100,
      note: "No draft: the weekly limit is reached.\n🧮 Claude: 3 turns, 41 s, from your weekly limit",
    });
    expect(w.net.telegram("deleteMessage")[0]?.body.message_id).toBe(7);
    const keyboard = w.net.telegram("sendMessage")[0]?.body.reply_markup;
    expect(keyboard.inline_keyboard[0][0].text).toBe("✍️ Draft a reply");
    expect(
      (await send(w, { type: "failed", item: ID, text: "Again" })).status,
    ).toBe(409);
    for (const kind of ["alarm", "alert"]) {
      await w.context.store.put({
        ...base(ID),
        kind,
        state: "fixing",
        entries: [],
      } as Item);
      await send(w, { type: "failed", item: ID, text: "No fix." });
      expect(await w.context.store.get(ID)).toMatchObject({
        state: "open",
        note: "No fix.",
      });
    }
    expect(
      (await send(w, { type: "failed", item: "i000000000000000", text: "x" }))
        .status,
    ).toBe(404);
  });

  it("puts what it took below a draft and a note", async () => {
    const w = await world();
    await w.context.store.put(contribution);
    await send(w, { type: "draft", item: ID, text: "Thanks!", usage });
    expect((await w.context.store.get(ID))?.note).toBe(
      "🧮 Claude: 3 turns, 41 s, from your weekly limit",
    );
    await send(w, { type: "note", item: ID, text: "See #4.", usage });
    expect((await w.context.store.get(ID))?.note).toBe(
      "See #4.\n🧮 Claude: 3 turns, 41 s, from your weekly limit",
    );
  });
});

describe("the schedule", () => {
  it("brings back what Later put aside, as a new message", async () => {
    const w = await world();
    const due = {
      ...contribution,
      state: "new" as const,
      snoozedUntil: START - 1,
    };
    await w.context.store.put(due);
    const later = {
      ...due,
      id: "i111111111111111",
      snoozedUntil: START + 3600000,
    };
    await w.context.store.put(later);
    expect(await runSchedule(w.context)).toEqual([ID]);
    expect(await w.context.store.get(ID)).toMatchObject({
      snoozedUntil: null,
      messageId: 100,
    });
    expect(w.net.telegram("deleteMessage")[0]?.body.message_id).toBe(7);
    expect(await w.context.store.due(START)).toEqual([]);
  });

  it("forgets the Later of a thing that is closed, or gone in between", async () => {
    const w = await world();
    const closed = {
      ...contribution,
      state: "sent" as const,
      snoozedUntil: START - 1,
    };
    await w.context.store.put({ ...closed, state: "new" });
    await w.context.store.put(closed);
    expect(await w.context.store.due(START + 1e12)).toEqual([]);
    const gone = {
      ...contribution,
      state: "new" as const,
      id: "i222222222222222",
      snoozedUntil: START - 1,
    };
    await w.context.store.put(gone);
    vi.spyOn(w.context.store, "get").mockResolvedValueOnce(null);
    expect(await runSchedule(w.context)).toEqual([]);
    expect(w.net.calls).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("reads the list of the Later page by page", async () => {
    const w = await world();
    for (const id of [
      "i111111111111111",
      "i222222222222222",
      "i333333333333333",
    ]) {
      await w.context.store.put({
        ...contribution,
        id,
        state: "new",
        snoozedUntil: START,
      });
    }
    await w.context.store.put({
      ...contribution,
      id: "i444444444444444",
      state: "new",
    });
    expect(await w.context.store.due(START, 1)).toHaveLength(3);
    expect(await w.context.store.due(START - 1, 2)).toEqual([]);
  });

  it("reminds of the token of Claude three weeks before, once", async () => {
    const w = await world({ tokenExpires: "2026-11-30" });
    expect(await runSchedule(w.context)).toEqual([]);
    w.clock.now = Date.parse("2026-11-09T08:00:00Z");
    const id = await itemId(keys.reminder("claude-token:2026-11-30"));
    expect(await runSchedule(w.context)).toEqual([id]);
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "expires in 21 days, on 2026-11-30",
    );
    expect(await runSchedule(w.context)).toEqual([]);
    const expired = await world({ tokenExpires: "2026-11-01" });
    await runSchedule(expired.context);
    expect(expired.net.telegram("sendMessage")[0]?.body.text).toContain(
      "on 2026-11-01: it has expired",
    );
    const none = await world();
    expect(await runSchedule(none.context)).toEqual([]);
  });
});
