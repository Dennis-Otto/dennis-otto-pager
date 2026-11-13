// /open in the chat: what still waits for the maintainer, one line per thing that
// offers a button, by repository, linked to its page on GitHub, with when ⏰ Later
// brings it back; done, ignored and quiet things stay out, and the list fits in
// one message.
import { describe, expect, it } from "vitest";

import { MAX_MESSAGE, visible } from "../src/render.ts";
import type { Contribution, Item } from "../src/store.ts";
import { handleUpdate } from "../src/updates.ts";
import { base, CHAT, REPO, START, type World, world } from "./helpers.ts";

const OTHER = "Dennis-Otto/another";
const HOUR = 60 * 60 * 1000;

function message(text: string, extra: object = {}) {
  return {
    message: {
      message_id: 500,
      chat: { id: CHAT },
      from: { id: CHAT },
      text,
      ...extra,
    },
  };
}

function contribution(
  id: string,
  number: number,
  extra: Partial<Contribution> = {},
): Contribution {
  return {
    ...base(id),
    kind: "contribution",
    state: "new",
    number,
    pull: false,
    title: `Issue ${number}`,
    url: `https://github.com/${REPO}/issues/${number}`,
    author: "octocat",
    draft: null,
    draftVersion: 0,
    ...extra,
  };
}

/** Ask for /open, and return its answer and the call that sent it. */
async function asked(w: World, extra: object = {}) {
  expect(await handleUpdate(w.context, message("/open", extra))).toBe("open");
  const sent = w.net.telegram("sendMessage");
  expect(sent).toHaveLength(1);
  return { text: String(sent[0]?.body.text), body: sent[0]?.body };
}

describe("/open", () => {
  it("says in one line that nothing waits", async () => {
    const w = await world();
    await w.context.store.put(
      contribution("i000000000000001", 1, { state: "sent" }),
    );
    const { text } = await asked(w);
    expect(text).toBe("✅ Nothing waits for you: no thing offers a button.");
    expect(w.net.calls).toHaveLength(1);
  });

  it("lists each open thing with a button, by repository, linked, with its Later", async () => {
    const w = await world();
    const things: Item[] = [
      contribution("i000000000000001", 12, { title: "It <breaks>" }),
      contribution("i000000000000002", 13, {
        state: "draft",
        draft: "Thanks!",
        snoozedUntil: START + 2 * HOUR,
      }),
      {
        ...base("i000000000000003"),
        repo: OTHER,
        kind: "alarm",
        state: "fixing",
        entries: [],
      },
      {
        ...base("i000000000000004"),
        repo: OTHER,
        kind: "alert",
        state: "open",
        entries: [],
      },
      {
        ...base("i000000000000005"),
        kind: "reminder",
        state: "open",
        text: "Renew",
      },
      {
        ...base("i000000000000006"),
        kind: "decision",
        state: "open",
        ask: "a1",
        question: "Ship it?",
        options: ["Yes", "No"],
        choice: null,
      },
      // A Later that is over waits for the schedule, which brings it back.
      contribution("i000000000000007", 14, { snoozedUntil: START - HOUR }),
      // Done, ignored, and a workflow that waits for the rerun of After the checks.
      contribution("i000000000000008", 15, { state: "done" }),
      contribution("i000000000000009", 16, { state: "ignored" }),
      {
        ...base("i00000000000000a"),
        kind: "workflow",
        state: "waiting",
        path: ".github/workflows/ci.yml",
        name: "CI",
        branch: "main",
        run: 5,
        attempt: 1,
        url: `https://github.com/${REPO}/actions/runs/5`,
        jobs: [],
        count: 1,
        since: START,
        last: START,
      },
    ];
    for (const thing of things) {
      await w.context.store.put(thing);
    }
    const { text, body } = await asked(w, { message_thread_id: 77 });
    expect(body?.message_thread_id).toBe(77);
    expect(text.split("\n")).toEqual([
      "📋 <b>What waits for you: 7</b>",
      "",
      `<b><a href="https://github.com/${OTHER}">${OTHER}</a></b>`,
      `<a href="https://github.com/${OTHER}/actions">🚨 another needs you</a>`,
      `<a href="https://github.com/${OTHER}/security">🛡 Security in another</a>`,
      "",
      `<b><a href="https://github.com/${REPO}">${REPO}</a></b>`,
      "🔔 Token of Claude",
      "🤔 Decision: Ship it?",
      `<a href="https://github.com/${REPO}/issues/12">🙋 demo#12 It &lt;breaks&gt;</a>`,
      `<a href="https://github.com/${REPO}/issues/13">🙋 demo#13 Issue 13</a> · ⏰ back on 2026-11-04 at 10:00 UTC`,
      `<a href="https://github.com/${REPO}/issues/14">🙋 demo#14 Issue 14</a>`,
    ]);
    // It acts on nothing and asks the control repository nothing.
    expect(w.net.calls).toHaveLength(1);
    expect(await w.context.store.get("i000000000000009")).toMatchObject({
      state: "ignored",
    });
  });

  it("fits in one message and counts what has no room", async () => {
    const w = await world();
    const title = "A long title ".repeat(8);
    for (let number = 0; number < 60; number += 1) {
      await w.context.store.put(
        contribution(`i${number.toString(16).padStart(15, "0")}`, number, {
          title,
        }),
      );
    }
    const { text } = await asked(w);
    const lines = text.split("\n");
    expect(visible(text)).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(lines[0]).toBe("📋 <b>What waits for you: 60</b>");
    const shown = lines.filter((line) => line.includes("🙋")).length;
    expect(shown).toBeGreaterThan(10);
    expect(lines.at(-1)).toBe(
      `… and ${60 - shown} more, for which this message has no room.`,
    );
    expect(lines.at(-2)).toBe("");
  });

  it("speaks German, and takes the name of the bot", async () => {
    const w = await world({ language: "de" });
    await w.context.store.put(
      contribution("i000000000000001", 12, { snoozedUntil: START + HOUR }),
    );
    expect(await handleUpdate(w.context, message("/open@RepoPagerBot"))).toBe(
      "open",
    );
    expect(String(w.net.telegram("sendMessage")[0]?.body.text)).toContain(
      "📋 <b>Was auf dich wartet: 1</b>",
    );
    expect(String(w.net.telegram("sendMessage")[0]?.body.text)).toContain(
      "· ⏰ zurück am 04.11.2026 um 09:00 UTC",
    );
  });

  it("reads the list page by page, and leaves out every closed record unread", async () => {
    const w = await world();
    await w.context.store.put(contribution("i000000000000001", 1));
    await w.context.store.put(
      contribution("i000000000000002", 2, { state: "sent" }),
    );
    await w.context.store.put(contribution("i000000000000003", 3));
    expect(await w.context.store.unclosed(1)).toEqual([
      "i000000000000001",
      "i000000000000003",
    ]);
  });
});
