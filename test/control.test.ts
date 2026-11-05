// The answers of the control repository, signed over the time and the body, and the
// schedule: "Later" that is over, and the reminder of the token of Claude.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { headTag } from "../src/buttons.ts";
import { handleControl, WINDOW } from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import { ANSWER_WITHIN, KEEP_LATE, runSchedule } from "../src/schedule.ts";
import {
  type Alarm,
  type Contribution,
  type Item,
  itemId,
  keys,
  type Release,
} from "../src/store.ts";
import { base, json, REPO, START, type World, world } from "./helpers.ts";

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
  const opus = { model: "claude-opus-5-5", tokens: 48213 };

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
      { type: "note", text: "x", usage: { ...usage, effort: 5 } },
      { type: "note", text: "x", usage: { ...usage, effort: "Extra High" } },
      { type: "note", text: "x", usage: { ...usage, models: "opus" } },
      { type: "note", text: "x", usage: { ...usage, models: [] } },
      {
        type: "note",
        text: "x",
        usage: { ...usage, models: Array(6).fill(opus) },
      },
      { type: "note", text: "x", usage: { ...usage, models: [null] } },
      {
        type: "note",
        text: "x",
        usage: { ...usage, models: [{ model: "<b>opus</b>", tokens: 1 }] },
      },
      {
        type: "note",
        text: "x",
        usage: { ...usage, models: [{ model: "claude-opus-5-5", tokens: 0 }] },
      },
      {
        type: "note",
        text: "x",
        usage: { ...usage, models: [{ model: "claude-opus-5-5", tokens: -2 }] },
      },
      { type: "note", text: "x", usage: { ...usage, models: [{ tokens: 5 }] } },
      { type: "note", text: "x", message: 0 },
      { type: "note", text: "x", message: -3 },
      { type: "note", text: "x", message: "500" },
      { type: "note", text: "x", message: 1.5 },
      { type: "failed", item: 7, text: "x" },
      { type: "draft", text: "x" },
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

  it("names the model, the effort and the tokens in the footer, on one line", async () => {
    const w = await world();
    const footers = async (...usages: unknown[]) => {
      for (const each of usages) {
        await send(w, { type: "note", text: "Done.", usage: each });
      }
      return w.net
        .telegram("sendMessage")
        .map((call) => call.body.text.split("\n\n")[1]);
    };
    expect(
      await footers(
        { ...usage, effort: "high", models: [opus] },
        { ...usage, effort: "xhigh", models: [opus] },
        { ...usage, models: [opus] },
        { ...usage, effort: "turbo", models: [opus] },
        {
          ...usage,
          effort: "max",
          models: [
            { model: "claude-haiku-5-5-20261001", tokens: 3213 },
            { model: "claude-opus-5-5", tokens: 45000 },
          ],
        },
        {
          ...usage,
          effort: "low",
          models: [
            { model: "claude-sonnet-5-5[1m]", tokens: 120000 },
            { model: "claude-3-5-haiku-20241022", tokens: 400 },
            { model: "us.anthropic.claude-x", tokens: 1000000 },
          ],
        },
      ),
    ).toEqual([
      "<i>🧮 Opus 5.5 · high · 48,213 tokens</i>",
      "<i>🧮 Opus 5.5 · extra high · 48,213 tokens</i>",
      "<i>🧮 Opus 5.5 · 48,213 tokens</i>",
      "<i>🧮 Opus 5.5 · turbo · 48,213 tokens</i>",
      "<i>🧮 Opus 5.5 93%, Haiku 5.5 7% · max · 48,213 tokens</i>",
      "<i>🧮 us.anthropic.claude-x 89%, Sonnet 5.5 11%, Haiku 3.5 &lt;1% · low · 1,120,400 tokens</i>",
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
      entries: [
        {
          key: "workflow:.github/workflows/release.yml",
          label: "The release fails: Release",
          url: `https://github.com/${REPO}/actions/runs/3/attempts/1`,
          run: 3,
        },
      ],
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
      { action: "rerun", target: { kind: "alarm", repo: REPO } },
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
      [[{ text: "✅ Confirm", callback_data: `rerun:${alarm.id}` }]],
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
    const models = [opus, { model: "claude-haiku-5-5", tokens: 100 }];
    await send(w, {
      type: "note",
      item: ID,
      text: "See #5.",
      usage: { ...usage, effort: "high", models },
    });
    // The message of the thing escapes its note, the footer with it.
    expect((await w.context.store.get(ID))?.note).toBe(
      "See #5.\n🧮 Opus 5.5 >99%, Haiku 5.5 <1% · high · 48,313 tokens",
    );
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      "<i>See #5.\n🧮 Opus 5.5 &gt;99%, Haiku 5.5 &lt;1% · high · 48,313 tokens</i>",
    );
  });
});

describe("the reaction on a text of the maintainer", () => {
  const reactions = (w: World) =>
    w.net
      .telegram("setMessageReaction")
      .map((call) => [call.body.message_id, call.body.reaction[0].emoji]);

  it("turns into 👍 when its answer or proposal came, and into 😢 when none came to be", async () => {
    const w = await world();
    for (const message of [500, 501, 502, 503]) {
      await w.context.store.ask(message, START);
    }
    expect(
      await send(w, { type: "note", text: "All green.", message: 500 }),
    ).toEqual({ status: 200, text: "said" });
    expect(
      await send(w, {
        type: "proposal",
        text: "Merge it?",
        action: "merge",
        target: { kind: "release", repo: REPO },
        message: 501,
      }),
    ).toEqual({ status: 200, text: "said" });
    expect(
      await send(w, {
        type: "failed",
        text: "❌ No answer: the weekly limit is reached.",
        message: 502,
      }),
    ).toEqual({ status: 200, text: "said" });
    expect(reactions(w)).toEqual([
      [500, "👍"],
      [501, "👍"],
      [502, "😢"],
    ]);
    expect(w.net.telegram("sendMessage").at(-1)?.body.text).toBe(
      "🤖 ❌ No answer: the weekly limit is reached.",
    );
    // Only the text without an answer still waits.
    expect(await w.context.store.waiting(START + 1)).toEqual([503]);
  });

  it("stays as it is for an answer to no text, such as a job started by hand", async () => {
    const w = await world();
    await send(w, { type: "note", text: "Pong." });
    await send(w, { type: "failed", text: "❌ No answer." });
    expect(reactions(w)).toEqual([]);
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
  });

  it("turns into 😢 on the schedule when no answer came within the hour", async () => {
    const w = await world();
    await w.context.store.ask(500, START);
    await w.context.store.ask(501, START + 30 * 60 * 1000);
    w.clock.now = START + ANSWER_WITHIN;
    await runSchedule(w.context);
    expect(reactions(w)).toEqual([]);
    w.clock.now = START + ANSWER_WITHIN + 15 * 60 * 1000;
    await runSchedule(w.context);
    expect(reactions(w)).toEqual([[500, "😢"]]);
    expect(await w.context.store.waiting(w.clock.now)).toEqual([501]);
    // A late answer still says that it came.
    await send(
      w,
      { type: "note", text: "Late.", message: 500 },
      {
        stamp: String(w.clock.now / 1000),
      },
    );
    expect(reactions(w)).toEqual([
      [500, "😢"],
      [500, "👍"],
    ]);
    w.clock.now = START + 2 * ANSWER_WITHIN;
    await runSchedule(w.context);
    await runSchedule(w.context);
    expect(reactions(w).at(-1)).toEqual([501, "😢"]);
    expect(reactions(w)).toHaveLength(3);
    expect(await w.context.store.waiting(w.clock.now)).toEqual([]);
  });
});

describe("the thread of an answer", () => {
  const sent = (w: World) =>
    w.net.telegram("sendMessage").map((call) => call.body);
  const reactions = (w: World) =>
    w.net
      .telegram("setMessageReaction")
      .map((call) => [call.body.message_id, call.body.reaction[0].emoji]);

  it("goes into the thread of the text that it answers: a note, a proposal, a failure", async () => {
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
    await w.context.store.put(release);
    await w.context.store.ask(500, START, 77);
    await w.context.store.ask(501, START, 78);
    await w.context.store.ask(502, START, 79);
    await send(w, { type: "note", text: "All green.", message: 500 });
    await send(w, {
      type: "proposal",
      text: "Merge it?",
      action: "merge",
      target: { kind: "release", repo: REPO },
      message: 501,
    });
    await send(w, { type: "failed", text: "❌ No answer.", message: 502 });
    expect(sent(w).map((body) => body.message_thread_id)).toEqual([77, 78, 79]);
    // The ✅ Confirm button of the proposal comes along into its thread.
    expect(sent(w)[1].reply_markup.inline_keyboard[0][0].text).toBe(
      "✅ Confirm",
    );
    expect(await w.context.store.waiting(START + 1)).toEqual([]);
  });

  it("goes into the main view for no text and a text from before threads", async () => {
    const w = await world();
    // A text kept by the version before threads: its time alone.
    await env.PAGER.put("asked", JSON.stringify({ 500: START, 501: START }));
    await w.context.store.ask(502, START, 77);
    expect(await w.context.store.waiting(START + 1)).toEqual([500, 501, 502]);
    await send(w, { type: "note", text: "Old job.", message: 500 });
    await send(w, { type: "note", text: "By hand." });
    expect(sent(w).map((body) => "message_thread_id" in body)).toEqual([
      false,
      false,
    ]);
  });

  it("keeps its thread for a late answer for a day, after the schedule gave up on its text", async () => {
    const w = await world();
    await w.context.store.ask(500, START, 77);
    await w.context.store.ask(501, START, 78);
    w.clock.now = START + ANSWER_WITHIN + 15 * 60 * 1000;
    await runSchedule(w.context);
    expect(reactions(w)).toEqual([
      [500, "😢"],
      [501, "😢"],
    ]);
    expect(await w.context.store.waiting(w.clock.now)).toEqual([]);
    // The 😢 comes once: a text given up on waits no longer.
    w.clock.now += 15 * 60 * 1000;
    await runSchedule(w.context);
    expect(reactions(w)).toHaveLength(2);
    // A late answer still goes into the thread of its text and turns it into 👍.
    await send(
      w,
      { type: "note", text: "Late.", message: 500 },
      { stamp: String(w.clock.now / 1000) },
    );
    expect(sent(w).at(-1)?.message_thread_id).toBe(77);
    expect(reactions(w).at(-1)).toEqual([500, "👍"]);
    expect(await w.context.store.thread(501)).toBe(78);
    // A day after the text went, the pager forgets its thread.
    w.clock.now = START + KEEP_LATE + 1;
    await runSchedule(w.context);
    expect(await w.context.store.thread(501)).toBeNull();
    expect(await env.PAGER.get("asked")).toBeNull();
  });

  it("forgets only the texts given up on a day ago and keeps those that wait", async () => {
    const w = await world();
    await w.context.store.ask(500, START, 77);
    await w.context.store.giveUp([500], START);
    await w.context.store.ask(501, START + KEEP_LATE, 78);
    await w.context.store.giveUp([], START + 1);
    expect(await w.context.store.thread(500)).toBeNull();
    expect(await w.context.store.thread(501)).toBe(78);
    expect(await w.context.store.waiting(START + KEEP_LATE + 1)).toEqual([501]);
    // An answer to a text that no longer waits changes nothing.
    await w.context.store.settle([500]);
    expect(await w.context.store.thread(501)).toBe(78);
  });

  it("falls back to the main view when Telegram doesn't find the thread", async () => {
    const w = await world();
    const warnings: unknown[][] = [];
    vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => {
      warnings.push(parts);
    });
    await w.context.store.ask(500, START, 77);
    // The thread is refused once, and the same message goes into the main view.
    let refused = false;
    w.net.on("POST", /sendMessage$/, () => {
      if (refused) {
        return json({ ok: true, result: { message_id: 101 } });
      }
      refused = true;
      return json(
        { ok: false, description: "Bad Request: message thread not found" },
        400,
      );
    });
    expect(
      await send(w, { type: "note", text: "Secret plan.", message: 500 }),
    ).toEqual({ status: 200, text: "said" });
    const [first, second] = sent(w);
    expect(first.message_thread_id).toBe(77);
    expect(second).toEqual({ ...first, message_thread_id: undefined });
    expect("message_thread_id" in second).toBe(false);
    expect(warnings).toEqual([
      ["Telegram sendMessage: thread 77 not found, sent to the main view"],
    ]);
    expect(JSON.stringify(warnings)).not.toContain("Secret plan");
    vi.restoreAllMocks();
  });
});

describe("the answer of a job for a thing", () => {
  const topic = { thread: 900, name: "🚨 demo needs you" };
  const alarm: Alarm = {
    ...base(ID),
    kind: "alarm",
    state: "fixing",
    entries: [
      {
        key: "issue:367",
        label: "A bot fails: Mutation fails on main",
        url: `https://github.com/${REPO}/issues/367`,
      },
    ],
  };
  // Each answer that a job of the control repository sends for its thing, and the
  // state of the thing while its job runs.
  const answers: [string, Item, object][] = [
    ["a draft", contribution, { type: "draft", text: "Thanks!" }],
    [
      "a draft that failed",
      contribution,
      { type: "failed", text: "No draft." },
    ],
    ["a fix with its pull request", alarm, { type: "note", text: "🛠 #3" }],
    ["a fix that failed", alarm, { type: "failed", text: "No fix: a 504." }],
  ];

  it.each(answers)(
    "goes into the thing's topic, as a new message that notifies: %s",
    async (_, item, answer) => {
      const w = await world();
      await w.context.store.put({ ...item, topic });
      expect((await send(w, { ...answer, item: ID })).status).toBe(200);
      const [message] = w.net.telegram("sendMessage").map((call) => call.body);
      expect(message?.message_thread_id).toBe(900);
      expect(message?.text).toContain((answer as { text: string }).text);
      // The old message of the thing goes, and the new one is its message now.
      expect(w.net.telegram("deleteMessage")[0]?.body.message_id).toBe(7);
      expect(await w.context.store.get(ID)).toMatchObject({
        messageId: 100,
        topic: { thread: 900 },
      });
    },
  );

  it.each(answers)(
    "goes into the main view only for a thing without a topic: %s",
    async (_, item, answer) => {
      const w = await world();
      await w.context.store.put({ ...item, topic: null });
      await send(w, { ...answer, item: ID });
      const [message] = w.net.telegram("sendMessage").map((call) => call.body);
      expect(message).toBeDefined();
      expect("message_thread_id" in message).toBe(false);
    },
  );

  it("edits a note in place when no job of its thing runs", async () => {
    const w = await world();
    await w.context.store.put({ ...alarm, state: "open", topic });
    expect(await send(w, { type: "note", item: ID, text: "Later." })).toEqual({
      status: 200,
      text: "noted",
    });
    expect(w.net.telegram("sendMessage")).toEqual([]);
    expect(w.net.telegram("editMessageText")[0]?.body.message_id).toBe(7);
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
    expect((await w.context.store.pending(START, 0)).due).toEqual([]);
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
    expect((await w.context.store.pending(START + 1e12, 0)).due).toEqual([]);
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
      jobStarted: START - 1,
    });
    expect((await w.context.store.pending(START, 0, 1)).due).toHaveLength(3);
    expect((await w.context.store.pending(START - 1, 0, 2)).due).toEqual([]);
    // The things whose job waits come from the same list, the Later aside.
    expect(await w.context.store.pending(START - 1, START, 1)).toEqual({
      due: [],
      waiting: ["i444444444444444"],
    });
    expect((await w.context.store.pending(START, START - 1)).waiting).toEqual(
      [],
    );
  });

  describe("a job of the control repository that never answers", () => {
    const fixing: Alarm = {
      ...base("i555555555555555"),
      kind: "alarm",
      state: "fixing",
      entries: [{ key: "check:lint", label: "lint fails", url: "" }],
      jobStarted: START,
    };
    const drafting: Contribution = { ...contribution, jobStarted: START };

    it("gives the thing its buttons back after the hour, once, with a note", async () => {
      const w = await world();
      await w.context.store.put(fixing);
      await w.context.store.put(drafting);
      w.clock.now = START + ANSWER_WITHIN;
      expect(await runSchedule(w.context)).toEqual([]);
      w.clock.now = START + ANSWER_WITHIN + 15 * 60000;
      expect((await runSchedule(w.context)).sort()).toEqual(
        [ID, fixing.id].sort(),
      );
      const note =
        "⌛ No answer from the control repository within the hour: its run in its Actions tab says why.";
      for (const [id, state] of [
        [fixing.id, "open"],
        [ID, "new"],
      ]) {
        const item = await w.context.store.get(id as string);
        expect(item).toMatchObject({ state, note });
        expect(item).not.toHaveProperty("jobStarted");
      }
      // A new message for each, which notifies, with the buttons of the state before.
      const sent = w.net.telegram("sendMessage").map((call) => call.body);
      expect(sent).toHaveLength(2);
      const buttons = sent.map((body) =>
        body.reply_markup.inline_keyboard
          .flat()
          .map((button: { text: string }) => button.text),
      );
      expect(buttons).toContainEqual(["🛠 Start fix", "⏰ Later", "✖ Ignore"]);
      expect(buttons).toContainEqual([
        "✍️ Draft a reply",
        "🤖 Assistant again",
        "⏰ Later",
        "✖ Ignore",
      ]);
      expect(w.net.telegram("deleteMessage")).toHaveLength(2);
      w.clock.now += 24 * 3600000;
      expect(await runSchedule(w.context)).toEqual([]);
    });

    it("leaves a thing alone whose job answered, also with a note that keeps it fixing", async () => {
      const w = await world();
      await w.context.store.put({ ...fixing, id: ID });
      expect(
        await send(w, { type: "note", item: ID, text: "🛠 The fix is in #3." }),
      ).toEqual({ status: 200, text: "noted" });
      const answered = await w.context.store.get(ID);
      expect(answered).toMatchObject({ state: "fixing" });
      expect(answered).not.toHaveProperty("jobStarted");
      w.clock.now = START + 2 * ANSWER_WITHIN;
      expect(await runSchedule(w.context)).toEqual([]);
      expect(await w.context.store.get(ID)).toMatchObject({ state: "fixing" });
    });

    it("trusts only the record, which the list may lag behind", async () => {
      const w = await world();
      // Gone in between, answered in between, and in a state of no job.
      await w.context.store.put(fixing);
      await w.context.store.put(drafting);
      await w.context.store.put({
        ...fixing,
        id: "i666666666666666",
        state: "open",
      });
      vi.spyOn(w.context.store, "get")
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...contribution });
      w.clock.now = START + 2 * ANSWER_WITHIN;
      expect(await runSchedule(w.context)).toEqual([]);
      expect(w.net.calls).toHaveLength(0);
      vi.restoreAllMocks();
    });
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
    const tomorrow = await world({ tokenExpires: "2026-11-05" });
    await runSchedule(tomorrow.context);
    expect(tomorrow.net.telegram("sendMessage")[0]?.body.text).toContain(
      "expires in 1 day, on 2026-11-05.",
    );
    const none = await world();
    expect(await runSchedule(none.context)).toEqual([]);
  });
});
