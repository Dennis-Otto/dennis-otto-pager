// The answers of the control repository, signed over the time and the body, and the
// schedule: "Later" that is over, and the reminder of the token of Claude.
import { describe, expect, it, vi } from "vitest";

import { handleControl, WINDOW } from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import { runSchedule } from "../src/schedule.ts";
import { type Contribution, type Item, itemId, keys } from "../src/store.ts";
import { base, START, type World, world } from "./helpers.ts";

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
