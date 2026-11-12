// What each signal does to the messages: a new one for a new thing, an edit as the
// thing changes, bundles per repository, and the steps of a release.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { press } from "../src/actions.ts";
import { allowed } from "../src/buttons.ts";
import { MAX_EXCERPT, NOTES_MARK } from "../src/content.ts";
import { apply, QUIET, show } from "../src/pager.ts";
import type { Signal } from "../src/rules.ts";
import {
  type Alarm,
  type Contribution,
  type Item,
  itemId,
  keys,
  type Release,
} from "../src/store.ts";
import {
  base,
  json,
  REPO,
  START,
  type World,
  withControl,
  withDeletedTopic,
  withTopics,
  world,
} from "./helpers.ts";

const at = { repo: REPO, installation: 9 };

function failing(
  key: string,
  title = `${key} fails`,
  run?: number,
  type: "failing" | "still-failing" = "failing",
): Signal {
  return {
    ...at,
    type,
    key,
    label: { key: "entry.bot", values: { title } },
    url: "https://github.com/x",
    ...(run === undefined ? {} : { run }),
  };
}

/** The bytes of UTF-8 that a record takes in Workers KV. */
function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

async function stored(w: World, key: string): Promise<Item | null> {
  return w.context.store.get(await itemId(key));
}

describe("contributions", () => {
  const signal: Signal = {
    ...at,
    type: "contribution",
    number: 12,
    pull: false,
    title: "It breaks",
    url: "https://github.com/Dennis-Otto/demo/issues/12",
    author: "octocat",
  };

  it("get one message each, once", async () => {
    const w = await world();
    expect(await apply(w.context, signal)).toBe("contribution shown");
    expect(await apply(w.context, signal)).toBe("contribution shown already");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    expect(await stored(w, keys.contribution(REPO, 12))).toMatchObject({
      kind: "contribution",
      state: "new",
      messageId: 100,
      draftVersion: 0,
    });
  });

  it("keep the start of what they say, and quote it", async () => {
    const w = await world();
    await apply(w.context, { ...signal, excerpt: "It crashes <here>" });
    expect(await stored(w, keys.contribution(REPO, 12))).toMatchObject({
      excerpt: "It crashes <here>",
    });
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "<blockquote expandable>It crashes &lt;here&gt;</blockquote>",
    );
  });

  it("keep their record small in Workers KV, with the longest quote", async () => {
    const w = await world();
    // Three bytes of UTF-8 for each character: the largest quote that fits.
    await apply(w.context, { ...signal, excerpt: "€".repeat(MAX_EXCERPT) });
    const thing = (await stored(
      w,
      keys.contribution(REPO, 12),
    )) as Contribution;
    const { excerpt: _excerpt, ...before } = thing;
    expect(bytes(thing) - bytes(before)).toBeLessThan(1600);
  });
});

describe("discussions", () => {
  const URL = "https://github.com/Dennis-Otto/demo/discussions/31";
  const opened: Signal = {
    ...at,
    type: "discussion",
    number: 31,
    title: "How do I start?",
    url: URL,
    author: "octocat",
    node: "D_1",
  };
  const commented: Signal = {
    ...opened,
    url: `${URL}#discussioncomment-7`,
    author: "hubot",
    comment: "DC_7",
  };

  /** A world whose chat has topics, and whose control repository takes the drafts. */
  async function chat(): Promise<World> {
    const w = await world();
    withTopics(w.net);
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    return w;
  }

  const thing = async (w: World) =>
    (await stored(w, keys.contribution(REPO, 31))) as Contribution;

  it("quote the discussion, and then the comment that the reply answers", async () => {
    const w = await chat();
    await apply(w.context, { ...opened, excerpt: "How do I start?" });
    expect((await thing(w)).excerpt).toBe("How do I start?");
    await apply(w.context, { ...commented, excerpt: "Me too" });
    expect((await thing(w)).excerpt).toBe("Me too");
    await apply(w.context, { ...commented, comment: "DC_8" });
    expect(await thing(w)).not.toHaveProperty("excerpt");
  });

  it("ask for their draft at once, in a topic of their own", async () => {
    const w = await chat();
    expect(await apply(w.context, opened)).toBe("discussion shown");
    const id = await itemId(keys.contribution(REPO, 31));
    expect(w.net.github("/dispatches")[0]?.body).toEqual({
      event_type: "pager-draft",
      client_payload: {
        item: id,
        repo: REPO,
        number: 31,
        pull: false,
        discussion: true,
        language: "en",
      },
    });
    expect(await thing(w)).toMatchObject({
      kind: "contribution",
      state: "drafting",
      jobStarted: START,
      discussion: { node: "D_1" },
      messageId: 100,
      topic: { thread: 900, name: "💬 demo#31 How do I start?" },
    });
    const message = w.net.telegram("sendMessage")[0]?.body;
    expect(message.text).toContain("💬 <b>New discussion</b> in");
    expect(message.text).toContain(`<a href="${URL}">#31 How do I start?</a>`);
    // While Claude drafts, the thing can only be ignored.
    expect(message.reply_markup.inline_keyboard).toEqual([
      [{ text: "✖ Ignore", callback_data: `ignore:${id}` }],
    ]);
  });

  it("answer the newest comment, with a new message, and open again once the reply went", async () => {
    const w = await chat();
    await apply(w.context, opened);
    const drafted = await thing(w);
    await w.context.store.put({
      ...drafted,
      state: "draft",
      draft: "Read the README.",
      draftVersion: 2,
    });
    expect(await apply(w.context, commented)).toBe("discussion shown anew");
    const answering = await thing(w);
    expect(answering).toMatchObject({
      state: "drafting",
      url: commented.url,
      author: "hubot",
      draft: null,
      // No button of the old draft sends the next one.
      draftVersion: 2,
      discussion: { node: "D_1", comment: "DC_7" },
      messageId: 101,
      topic: { thread: 900 },
    });
    expect(w.net.github("/dispatches")[1]?.body.client_payload).toMatchObject({
      discussion: true,
      comment: "DC_7",
    });
    // The open message of the old one goes, as "Later" does with its own.
    expect(
      w.net.telegram("deleteMessage").map((c) => c.body.message_id),
    ).toEqual([100]);
    expect(w.net.telegram("sendMessage")[1]?.body).toMatchObject({
      text: expect.stringContaining("💬 <b>New comment</b> on a discussion in"),
      message_thread_id: 900,
    });

    await w.context.store.put({
      ...answering,
      state: "sent",
      topic: { thread: 900, name: "✅ 💬 demo#31 How do I start?" },
    });
    expect(await apply(w.context, { ...commented, comment: "DC_8" })).toBe(
      "discussion shown anew",
    );
    // The message of the reply that went stays as history, in the same topic.
    expect(w.net.telegram("deleteMessage")).toHaveLength(1);
    expect(w.net.telegram("sendMessage")[2]?.body.message_thread_id).toBe(900);
    expect(w.net.telegram("createForumTopic")).toHaveLength(1);
    expect(
      w.net.telegram("editForumTopic").map((call) => call.body.name),
    ).toEqual(["💬 demo#31 How do I start?"]);
    expect(await thing(w)).toMatchObject({
      state: "drafting",
      messageId: 102,
      discussion: { comment: "DC_8" },
    });
  });

  it("wait with the draft of a new comment while the draft of an older one is written", async () => {
    const w = await chat();
    await apply(w.context, opened);
    w.clock.now = START + 60_000;
    expect(await apply(w.context, commented)).toBe(
      "discussion shown anew, its draft waits for the older one",
    );
    // The control repository runs one job per thing at a time: the next one is
    // asked for once the draft of the older one comes, and is dropped.
    expect(w.net.github("/dispatches")).toHaveLength(1);
    expect(await thing(w)).toMatchObject({
      state: "drafting",
      jobStarted: START + 60_000,
      url: commented.url,
      discussion: { node: "D_1", comment: "DC_7", redraft: true },
      messageId: 101,
    });
    expect(
      w.net.telegram("deleteMessage").map((c) => c.body.message_id),
    ).toEqual([100]);
  });

  it("keep the maintainer's own draft for a new comment, and ask for none", async () => {
    const w = await chat();
    await apply(w.context, opened);
    const id = await itemId(keys.contribution(REPO, 31));
    await w.context.store.put({
      ...(await thing(w)),
      state: "draft",
      draft: "My own words.",
      draftVersion: 3,
      ownDraft: true,
    });
    expect(await apply(w.context, commented)).toBe(
      "discussion shown anew, with the maintainer's own draft",
    );
    expect(w.net.github("/dispatches")).toHaveLength(1);
    expect(await thing(w)).toMatchObject({
      state: "draft",
      draft: "My own words.",
      // It answers the new comment now: no button of the old message sends it.
      draftVersion: 4,
      ownDraft: true,
      url: commented.url,
      author: "hubot",
      discussion: { node: "D_1", comment: "DC_7" },
      note: "✏️ A new comment came, and your own text stays the draft: send it, or edit it for the new comment.",
      messageId: 101,
    });
    expect(
      w.net.telegram("deleteMessage").map((c) => c.body.message_id),
    ).toEqual([100]);
    const message = w.net.telegram("sendMessage")[1]?.body;
    expect(message.message_thread_id).toBe(900);
    expect(message.text).toContain("<blockquote>My own words.</blockquote>");
    expect(message.reply_markup.inline_keyboard).toEqual([
      [
        { text: "✅ Send", callback_data: `send:${id}:4` },
        { text: "✏️ Edit", callback_data: `edit:${id}` },
      ],
      [{ text: "✖ Ignore", callback_data: `ignore:${id}` }],
    ]);
  });

  it("close once GitHub dealt with them, and say why, in place", async () => {
    const notes = {
      replied: "💬 You replied on GitHub, so the pager sends nothing.",
      answered: "✅ An answer was marked on GitHub.",
      closed: "Closed on GitHub.",
      deleted: "Deleted on GitHub.",
    } as const;
    for (const [reason, note] of Object.entries(notes)) {
      const w = await chat();
      await apply(w.context, opened);
      await apply(w.context, commented);
      await w.context.store.put({
        ...(await thing(w)),
        draft: "Read the README.",
      });
      const done: Signal = {
        ...at,
        type: "discussion-done",
        number: 31,
        reason: reason as keyof typeof notes,
      };
      expect(await apply(w.context, done)).toBe(`discussion done: ${reason}`);
      const closed = await thing(w);
      expect(closed).toMatchObject({ state: "done", note, messageId: 101 });
      // Nothing waits for its job any more, nor for the draft of the newest comment.
      expect(closed).not.toHaveProperty("jobStarted");
      expect(closed.discussion).toEqual({ node: "D_1", comment: "DC_7" });
      // Its buttons go and its draft with them, in place, which notifies nobody.
      const edited = w.net.telegram("editMessageText").at(-1)?.body;
      expect(edited).toMatchObject({
        message_id: 101,
        reply_markup: { inline_keyboard: [] },
      });
      expect(edited.text).toContain("✅ Done.");
      expect(edited.text).toContain(`<i>${note}</i>`);
      expect(edited.text).not.toContain("Read the README.");
      expect(w.net.telegram("sendMessage")).toHaveLength(2);
      expect(w.net.telegram("editForumTopic").at(-1)?.body.name).toBe(
        "✅ 💬 demo#31 How do I start?",
      );
      // A thing that is closed already stays as it is.
      const calls = w.net.calls.length;
      expect(await apply(w.context, done)).toBe("no open discussion shown");
      expect(w.net.calls).toHaveLength(calls);
    }
  });

  it("know no end of a discussion that they never showed, nor of an issue", async () => {
    const w = await chat();
    const done: Signal = {
      ...at,
      type: "discussion-done",
      number: 31,
      reason: "replied",
    };
    expect(await apply(w.context, done)).toBe("no open discussion shown");
    await apply(w.context, {
      ...at,
      type: "contribution",
      number: 31,
      pull: false,
      title: "It breaks",
      url: "https://github.com/Dennis-Otto/demo/issues/31",
      author: "octocat",
    });
    expect(await apply(w.context, done)).toBe("no open discussion shown");
    expect(await thing(w)).toMatchObject({ state: "new" });
  });

  it("stay ignored once they were ignored", async () => {
    const w = await chat();
    await apply(w.context, opened);
    await w.context.store.put({ ...(await thing(w)), state: "ignored" });
    const calls = w.net.calls.length;
    expect(await apply(w.context, commented)).toBe("discussion ignored");
    expect(w.net.calls).toHaveLength(calls);
  });

  it("come without a draft, and say why, when the control repository can't take it", async () => {
    const w = await world();
    expect(await apply(w.context, opened)).toBe(
      "discussion shown, without a draft",
    );
    const id = await itemId(keys.contribution(REPO, 31));
    expect(await thing(w)).toMatchObject({
      state: "new",
      note: expect.stringContaining("isn't installed on Dennis-Otto/control"),
    });
    expect(await w.context.store.get(id)).not.toHaveProperty("jobStarted");
    const buttons = w.net.telegram("sendMessage")[0]?.body.reply_markup;
    expect(buttons.inline_keyboard).toEqual([
      [
        { text: "✍️ Draft a reply", callback_data: `draft:${id}` },
        { text: "✖ Ignore", callback_data: `ignore:${id}` },
      ],
    ]);
    withControl(w.net).on("POST", "/repos/Dennis-Otto/control/dispatches", () =>
      json({ message: "Server Error" }, 502),
    );
    expect(await apply(w.context, commented)).toBe(
      "discussion shown anew, without a draft",
    );
    expect((await thing(w)).note).toBe("GitHub refused: Server Error");
    // Anything else than an answer of GitHub goes to the log of the webhook.
    w.net.on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response("{", { status: 200 }),
    );
    w.net.on(
      "GET",
      "/repos/Dennis-Otto/control/installation",
      () => new Response("{", { status: 200 }),
    );
    await expect(
      apply(w.context, { ...commented, comment: "DC_8" }),
    ).rejects.toThrow(SyntaxError);
  });
});

describe("comments on issues and pull requests", () => {
  const ISSUE = "https://github.com/Dennis-Otto/demo/issues/12";
  const opened: Signal = {
    ...at,
    type: "contribution",
    number: 12,
    pull: false,
    title: "It breaks",
    url: ISSUE,
    author: "octocat",
  };
  const commented = (
    comment = 99,
    author = "hubot",
  ): Extract<Signal, { type: "comment" }> => ({
    ...at,
    type: "comment",
    number: 12,
    pull: false,
    title: "It breaks",
    url: `${ISSUE}#issuecomment-${comment}`,
    author,
    comment,
  });

  /** A world whose chat has topics, and whose control repository takes the drafts. */
  async function chat(): Promise<World> {
    const w = await world();
    withTopics(w.net);
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    return w;
  }

  const thing = async (w: World) =>
    (await stored(w, keys.contribution(REPO, 12))) as Contribution;

  /** A world with the issue shown, in its topic 900, as message 100. */
  async function shown(): Promise<World> {
    const w = await chat();
    await apply(w.context, opened);
    return w;
  }

  it("edit the message of an open thing in place, and notify once in its topic", async () => {
    const w = await shown();
    expect(await apply(w.context, commented())).toBe("comment shown in place");
    expect(await thing(w)).toMatchObject({
      state: "new",
      url: `${ISSUE}#issuecomment-99`,
      author: "hubot",
      comment: { id: 99, noticed: START },
      messageId: 100,
    });
    const edited = w.net.telegram("editMessageText")[0]?.body;
    expect(edited.message_id).toBe(100);
    expect(edited.text).toContain(
      "💬 <b>New comment</b> on an issue in <a href=",
    );
    expect(edited.text).toContain("by <b>hubot</b>");
    expect(edited.text).toContain(
      `<a href="${ISSUE}#issuecomment-99">#12 It breaks</a>`,
    );
    // The buttons stay those of a new issue.
    expect(
      edited.reply_markup.inline_keyboard
        .flat()
        .map((button: { text: string }) => button.text),
    ).toEqual([
      "✍️ Draft a reply",
      "🤖 Assistant again",
      "⏰ Later",
      "✖ Ignore",
    ]);
    // The edit notifies nobody: one message below it in the topic does.
    const [, notice] = w.net.telegram("sendMessage");
    expect(notice?.body).toMatchObject({
      text: `💬 <b>hubot</b> commented: <a href="${ISSUE}#issuecomment-99">#12 It breaks</a>`,
      message_thread_id: 900,
      reply_markup: { inline_keyboard: [] },
    });
    expect(w.net.telegram("createForumTopic")).toHaveLength(1);
  });

  it("open a new topic when the maintainer deleted the old one, and notify once there", async () => {
    const w = await shown();
    withDeletedTopic(w.net, 900, [100]);
    expect(await apply(w.context, commented())).toBe(
      "comment shown in a new message",
    );
    const messages = w.net.telegram("sendMessage").map((call) => call.body);
    expect(messages.map((body) => body.message_thread_id)).toEqual([
      900, 900, 901,
    ]);
    // The new message names the comment and notified: no notice below it.
    expect(messages.at(-1)?.text).toContain(
      `<a href="${ISSUE}#issuecomment-99">#12 It breaks</a>`,
    );
    expect(await thing(w)).toMatchObject({
      messageId: 101,
      topic: { thread: 901, name: "🙋 demo#12 It breaks" },
    });
    // The next comment notifies below it, in the new topic.
    w.clock.now = START + QUIET;
    expect(await apply(w.context, commented(100))).toBe(
      "comment shown in place",
    );
    expect(w.net.telegram("sendMessage").at(-1)?.body).toMatchObject({
      message_thread_id: 901,
      text: `💬 <b>hubot</b> commented: <a href="${ISSUE}#issuecomment-100">#12 It breaks</a>`,
    });
    expect(w.net.telegram("createForumTopic")).toHaveLength(2);
  });

  it("take the notice into a new topic, below the thing's message anew, when only the topic is gone", async () => {
    const w = await shown();
    // The topic went after its message was edited, so the notice finds no thread.
    withDeletedTopic(w.net, 900);
    expect(await apply(w.context, commented())).toBe("comment shown in place");
    const messages = w.net.telegram("sendMessage").map((call) => call.body);
    expect(messages.map((body) => body.message_thread_id)).toEqual([
      900, 900, 901, 901,
    ]);
    expect(
      messages[2]?.reply_markup.inline_keyboard
        .flat()
        .map((button: { text: string }) => button.text),
    ).toContain("✍️ Draft a reply");
    expect(messages[3]).toMatchObject({
      text: `💬 <b>hubot</b> commented: <a href="${ISSUE}#issuecomment-99">#12 It breaks</a>`,
      reply_markup: { inline_keyboard: [] },
    });
    expect(messages[3]).not.toHaveProperty("reply_parameters");
    expect(await thing(w)).toMatchObject({
      messageId: 101,
      comment: { id: 99, noticed: START },
      topic: { thread: 901, name: "🙋 demo#12 It breaks" },
    });
    expect((await w.context.store.byTopic(901))?.id).toBe((await thing(w)).id);
  });

  it("quote the newest comment, which the reply answers", async () => {
    const w = await chat();
    await apply(w.context, { ...opened, excerpt: "The issue" });
    await apply(w.context, { ...commented(99), excerpt: "The comment" });
    expect((await thing(w)).excerpt).toBe("The comment");
    expect(w.net.telegram("editMessageText")[0]?.body.text).toContain(
      "<blockquote expandable>The comment</blockquote>",
    );
    // A comment that says nothing quotes nothing, not an older text.
    await apply(w.context, commented(100));
    expect(await thing(w)).not.toHaveProperty("excerpt");
    // One on a thing whose reply went comes with its own.
    const done = await thing(w);
    done.state = "sent";
    await w.context.store.put(done);
    await apply(w.context, { ...commented(101), excerpt: "Again" });
    expect((await thing(w)).excerpt).toBe("Again");
  });

  it("notify once for a few quick comments, and again once it was quiet for a while", async () => {
    const w = await shown();
    await apply(w.context, commented(99));
    w.clock.now = START + QUIET - 1;
    expect(await apply(w.context, commented(100, "octocat"))).toBe(
      "comment shown in place, quietly",
    );
    expect(await thing(w)).toMatchObject({
      author: "octocat",
      comment: { id: 100, noticed: START },
    });
    expect(w.net.telegram("editMessageText")).toHaveLength(2);
    expect(w.net.telegram("editMessageText")[1]?.body.text).toContain(
      "by <b>octocat</b>",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
    w.clock.now = START + QUIET * 2;
    expect(await apply(w.context, commented(101))).toBe(
      "comment shown in place",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(3);
    expect((await thing(w)).comment).toEqual({
      id: 101,
      noticed: START + QUIET * 2,
    });
  });

  it("change nothing for the same comment twice", async () => {
    const w = await shown();
    await apply(w.context, commented());
    const calls = w.net.calls.length;
    expect(await apply(w.context, commented())).toBe("comment shown already");
    expect(w.net.calls).toHaveLength(calls);
    // The same holds for a thing that the comment made or opened again.
    const fresh = await chat();
    expect(await apply(fresh.context, commented())).toBe("comment shown");
    const made = fresh.net.calls.length;
    expect(await apply(fresh.context, commented())).toBe(
      "comment shown already",
    );
    expect(fresh.net.calls).toHaveLength(made);
  });

  it("change nothing for an older comment that comes after a newer one", async () => {
    const w = await shown();
    await apply(w.context, commented(101));
    const calls = w.net.calls.length;
    const before = await thing(w);
    expect(await apply(w.context, commented(100, "octocat"))).toBe(
      "comment shown already",
    );
    expect(w.net.calls).toHaveLength(calls);
    expect(await thing(w)).toEqual(before);
  });

  it("make a new thing of an issue that the pager never showed, or whose record expired", async () => {
    const w = await chat();
    expect(
      await apply(w.context, { ...commented(), pull: true, title: "Fix it" }),
    ).toBe("comment shown");
    const id = await itemId(keys.contribution(REPO, 12));
    expect(await thing(w)).toMatchObject({
      state: "new",
      pull: true,
      draft: null,
      draftVersion: 0,
      comment: { id: 99, noticed: START },
      messageId: 100,
      topic: { thread: 900, name: "🙋 demo#12 Fix it" },
    });
    const message = w.net.telegram("sendMessage")[0]?.body;
    expect(message.text).toContain(
      "💬 <b>New comment</b> on a pull request in",
    );
    // The new message notifies by itself; the issue assistant answers no pull request.
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    expect(message.reply_markup.inline_keyboard).toEqual([
      [
        { text: "✍️ Draft a reply", callback_data: `draft:${id}` },
        { text: "⏰ Later", callback_data: `later:${id}` },
      ],
      [{ text: "✖ Ignore", callback_data: `ignore:${id}` }],
    ]);
  });

  it("open a thing again in its topic once its reply went, or GitHub dealt with it", async () => {
    for (const state of ["sent", "done"] as const) {
      const w = await shown();
      await w.context.store.put({
        ...(await thing(w)),
        state,
        draft: "Fixed in 1.2.",
        draftVersion: 2,
        topic: { thread: 900, name: "✅ 🙋 demo#12 It breaks" },
      });
      expect(await apply(w.context, commented())).toBe("comment shown anew");
      expect(await thing(w)).toMatchObject({
        state: "new",
        draft: null,
        // No button of the old draft sends the next one.
        draftVersion: 2,
        note: null,
        url: `${ISSUE}#issuecomment-99`,
        comment: { id: 99, noticed: START },
        messageId: 101,
        topic: { thread: 900, name: "🙋 demo#12 It breaks" },
      });
      // The old message stays as history, and the new one notifies, in the same topic.
      expect(w.net.telegram("deleteMessage")).toHaveLength(0);
      expect(w.net.telegram("sendMessage")).toHaveLength(2);
      expect(w.net.telegram("sendMessage")[1]?.body).toMatchObject({
        text: expect.stringContaining("💬 <b>New comment</b> on an issue in"),
        message_thread_id: 900,
      });
      expect(w.net.telegram("createForumTopic")).toHaveLength(1);
      expect(w.net.telegram("editForumTopic").at(-1)?.body.name).toBe(
        "🙋 demo#12 It breaks",
      );
    }
  });

  it("stay ignored once they were ignored", async () => {
    const w = await shown();
    await w.context.store.put({ ...(await thing(w)), state: "ignored" });
    const calls = w.net.calls.length;
    expect(await apply(w.context, commented())).toBe("comment ignored");
    expect(w.net.calls).toHaveLength(calls);
  });

  it("bring back a thing put off with Later", async () => {
    const w = await shown();
    await w.context.store.put({
      ...(await thing(w)),
      snoozedUntil: START + 3_600_000,
      note: "🤖 The issue assistant answers again.",
    });
    await apply(w.context, commented());
    expect(await thing(w)).toMatchObject({ snoozedUntil: null, note: null });
    expect(w.net.telegram("editMessageText")[0]?.body.text).not.toContain(
      "assistant",
    );
  });

  it("wait with the draft of a new comment while the draft of an older message is written", async () => {
    const w = await shown();
    await w.context.store.put({
      ...(await thing(w)),
      state: "drafting",
      jobStarted: START,
    });
    w.clock.now = START + 60_000;
    expect(await apply(w.context, commented())).toBe(
      "comment shown in place, its draft waits for the older one",
    );
    // The control repository runs one job per thing at a time: the next one is
    // asked for once the draft of the older message comes, and is dropped.
    expect(w.net.github("/dispatches")).toHaveLength(0);
    expect(await thing(w)).toMatchObject({
      state: "drafting",
      jobStarted: START + 60_000,
      comment: { id: 99, noticed: START + 60_000, redraft: true },
      messageId: 100,
    });
  });

  it("ask again for a draft that answers an older message", async () => {
    const w = await shown();
    const id = await itemId(keys.contribution(REPO, 12));
    await w.context.store.put({
      ...(await thing(w)),
      state: "draft",
      draft: "Which version?",
      draftVersion: 1,
    });
    expect(await apply(w.context, commented())).toBe(
      "comment shown in place, drafted again",
    );
    expect(w.net.github("/dispatches")[0]?.body).toEqual({
      event_type: "pager-draft",
      client_payload: {
        item: id,
        repo: REPO,
        number: 12,
        pull: false,
        issueComment: 99,
        language: "en",
      },
    });
    const drafting = await thing(w);
    expect(drafting).toMatchObject({
      state: "drafting",
      draft: null,
      draftVersion: 2,
      jobStarted: START,
      comment: { id: 99, noticed: START },
    });
    expect(drafting.comment).not.toHaveProperty("redraft");
    const edited = w.net.telegram("editMessageText")[0]?.body;
    expect(edited.text).not.toContain("Which version?");
    expect(edited.text).toContain("✍️ The control repository drafts a reply…");
  });

  it("come without a draft, and say why, when the control repository can't take it", async () => {
    const w = await world();
    await apply(w.context, opened);
    await w.context.store.put({
      ...(await thing(w)),
      state: "draft",
      draft: "Which version?",
      draftVersion: 1,
    });
    expect(await apply(w.context, commented())).toBe(
      "comment shown in place, without a draft",
    );
    expect(await thing(w)).toMatchObject({
      state: "new",
      draft: null,
      draftVersion: 2,
      note: expect.stringContaining("isn't installed on Dennis-Otto/control"),
    });
    // In a chat without topics, the notice answers the message of the thing.
    expect(w.net.telegram("sendMessage")[1]?.body).toMatchObject({
      text: expect.stringContaining("<b>hubot</b> commented"),
      reply_parameters: { message_id: 100 },
    });
  });

  it("keep the maintainer's own draft for a new comment, and ask for none", async () => {
    const w = await shown();
    const id = await itemId(keys.contribution(REPO, 12));
    await w.context.store.put({
      ...(await thing(w)),
      state: "draft",
      draft: "My own words.",
      draftVersion: 3,
      ownDraft: true,
    });
    expect(await apply(w.context, commented())).toBe(
      "comment shown in place, with the maintainer's own draft",
    );
    expect(w.net.github("/dispatches")).toHaveLength(0);
    expect(await thing(w)).toMatchObject({
      state: "draft",
      draft: "My own words.",
      draftVersion: 4,
      ownDraft: true,
      note: "✏️ A new comment came, and your own text stays the draft: send it, or edit it for the new comment.",
    });
    const edited = w.net.telegram("editMessageText")[0]?.body;
    expect(edited.text).toContain("<blockquote>My own words.</blockquote>");
    expect(edited.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "✅ Send",
      callback_data: `send:${id}:4`,
    });
  });

  it("close once GitHub dealt with them, and say why, in place", async () => {
    const notes = {
      replied: "💬 You replied on GitHub, so the pager sends nothing.",
      closed: "Closed on GitHub.",
      merged: "🔀 Merged.",
    } as const;
    for (const [reason, note] of Object.entries(notes)) {
      const w = await shown();
      await apply(w.context, commented());
      await w.context.store.put({
        ...(await thing(w)),
        state: "drafting",
        jobStarted: START,
        comment: { id: 99, noticed: START, redraft: true },
      });
      const done: Signal = {
        ...at,
        type: "contribution-done",
        number: 12,
        reason: reason as keyof typeof notes,
      };
      expect(await apply(w.context, done)).toBe(`contribution done: ${reason}`);
      const closed = await thing(w);
      expect(closed).toMatchObject({ state: "done", note, messageId: 100 });
      // Nothing waits for its job any more, nor for the draft of the newest comment.
      expect(closed).not.toHaveProperty("jobStarted");
      expect(closed.comment).toEqual({ id: 99, noticed: START });
      const edited = w.net.telegram("editMessageText").at(-1)?.body;
      expect(edited).toMatchObject({
        message_id: 100,
        reply_markup: { inline_keyboard: [] },
      });
      expect(edited.text).toContain("✅ Done.");
      expect(edited.text).toContain(`<i>${note}</i>`);
      // In place, which notifies nobody: the issue and the notice of the comment.
      expect(w.net.telegram("sendMessage")).toHaveLength(2);
      expect(w.net.telegram("editForumTopic").at(-1)?.body.name).toBe(
        "✅ 🙋 demo#12 It breaks",
      );
      const calls = w.net.calls.length;
      expect(await apply(w.context, done)).toBe("no open contribution shown");
      expect(w.net.calls).toHaveLength(calls);
    }
  });

  it("know no end of an issue that they never showed, nor of a discussion", async () => {
    const w = await chat();
    const done: Signal = {
      ...at,
      type: "contribution-done",
      number: 12,
      reason: "closed",
    };
    expect(await apply(w.context, done)).toBe("no open contribution shown");
    await apply(w.context, {
      ...at,
      type: "discussion",
      number: 12,
      title: "How do I start?",
      url: "https://github.com/Dennis-Otto/demo/discussions/12",
      author: "octocat",
      node: "D_1",
    });
    expect(await apply(w.context, done)).toBe("no open contribution shown");
    expect(await thing(w)).toMatchObject({ state: "drafting" });
  });
});

describe("reviews and what else someone does to a pull request or an issue", () => {
  const PULL = "https://github.com/Dennis-Otto/demo/pull/12";
  const opened: Signal = {
    ...at,
    type: "contribution",
    number: 12,
    pull: true,
    title: "Fix it",
    url: PULL,
    author: "octocat",
    excerpt: "It fixes the crash",
  };
  const remark = (
    comment: number,
    kind?: "review" | "reviewComment",
    author = "hubot",
  ): Extract<Signal, { type: "comment" }> => ({
    ...at,
    type: "comment",
    number: 12,
    pull: true,
    title: "Fix it",
    url: `${PULL}#${kind ?? "issuecomment"}-${comment}`,
    author,
    comment,
    ...(kind === undefined ? {} : { kind }),
  });
  const did = (
    what: "commits" | "reopened" | "ready",
    changed: string | null = "2026-11-12T08:00:00Z",
  ): Extract<Signal, { type: "activity" }> => ({
    ...at,
    type: "activity",
    number: 12,
    pull: true,
    title: "Fix it",
    url: PULL,
    author: "octocat",
    by: "octocat",
    what,
    ...(changed === null ? {} : { changed }),
    excerpt: "It fixes the crash",
  });

  async function chat(): Promise<World> {
    const w = await world();
    withTopics(w.net);
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    return w;
  }

  const thing = async (w: World) =>
    (await stored(w, keys.contribution(REPO, 12))) as Contribution;

  /** A world with the pull request shown, in its topic 900, as message 100. */
  async function shown(): Promise<World> {
    const w = await chat();
    await apply(w.context, opened);
    return w;
  }

  it("show a review of someone else as the newest message, and notify once", async () => {
    const w = await shown();
    expect(await apply(w.context, remark(7, "review"))).toBe(
      "comment shown in place",
    );
    expect(await thing(w)).toMatchObject({
      url: `${PULL}#review-7`,
      author: "hubot",
      comment: { id: 7, kind: "review", noticed: START },
    });
    expect(w.net.telegram("editMessageText")[0]?.body.text).toContain(
      "💬 <b>New review</b> of a pull request in <a href=",
    );
    expect(w.net.telegram("sendMessage")[1]?.body).toMatchObject({
      text: `💬 <b>hubot</b> reviewed: <a href="${PULL}#review-7">#12 Fix it</a>`,
      message_thread_id: 900,
    });
  });

  it("show a reply in the thread of a review as a comment on the pull request", async () => {
    const w = await shown();
    expect(await apply(w.context, remark(5, "reviewComment"))).toBe(
      "comment shown in place",
    );
    expect(w.net.telegram("editMessageText")[0]?.body.text).toContain(
      "💬 <b>New comment</b> on a pull request in",
    );
    expect(w.net.telegram("sendMessage")[1]?.body.text).toBe(
      `💬 <b>hubot</b> commented: <a href="${PULL}#reviewComment-5">#12 Fix it</a>`,
    );
  });

  it("compare the ids of comments only within their kind", async () => {
    const w = await shown();
    await apply(w.context, remark(99));
    // A review comment has ids of its own, smaller here: it is news all the same.
    expect(await apply(w.context, remark(5, "reviewComment"))).toBe(
      "comment shown in place, quietly",
    );
    expect((await thing(w)).comment).toEqual({
      id: 5,
      kind: "reviewComment",
      seen: { issueComment: 99, reviewComment: 5 },
      noticed: START,
    });
    const calls = w.net.calls.length;
    const before = await thing(w);
    // The same review comment twice, and the older comment of the conversation
    // that a redelivery brings back, change nothing.
    expect(await apply(w.context, remark(5, "reviewComment"))).toBe(
      "comment shown already",
    );
    expect(await apply(w.context, remark(98))).toBe("comment shown already");
    expect(w.net.calls).toHaveLength(calls);
    expect(await thing(w)).toEqual(before);
    // A newer one of the first kind still counts, and keeps what the other saw.
    expect(await apply(w.context, remark(100))).toBe(
      "comment shown in place, quietly",
    );
    expect((await thing(w)).comment).toEqual({
      id: 100,
      seen: { issueComment: 100, reviewComment: 5 },
      noticed: START,
    });
  });

  it("read the comment of a thing from before the reviews as one of its conversation", async () => {
    const w = await shown();
    await w.context.store.put({
      ...(await thing(w)),
      comment: { id: 99, noticed: START },
    });
    expect(await apply(w.context, remark(99))).toBe("comment shown already");
    w.clock.now = START + QUIET;
    expect(await apply(w.context, remark(3, "review"))).toBe(
      "comment shown in place",
    );
    expect((await thing(w)).comment).toMatchObject({
      id: 3,
      kind: "review",
      seen: { issueComment: 99, review: 3 },
    });
  });

  it("name a review or a review comment in the draft by its own field", async () => {
    for (const kind of ["review", "reviewComment"] as const) {
      const w = await shown();
      await w.context.store.put({
        ...(await thing(w)),
        state: "draft",
        draft: "Thanks!",
        draftVersion: 1,
      });
      expect(await apply(w.context, remark(7, kind))).toBe(
        "comment shown in place, drafted again",
      );
      expect(w.net.github("/dispatches")[0]?.body.client_payload).toEqual({
        item: await itemId(keys.contribution(REPO, 12)),
        repo: REPO,
        number: 12,
        pull: true,
        [kind]: 7,
        language: "en",
      });
    }
  });

  it("name new commits on an open thing in place, and notify once in its topic", async () => {
    const w = await shown();
    await w.context.store.put({
      ...(await thing(w)),
      snoozedUntil: START + 3_600_000,
    });
    expect(await apply(w.context, did("commits"))).toBe(
      "commits shown in place",
    );
    expect(await thing(w)).toMatchObject({
      state: "new",
      note: "🔁 New commits by octocat.",
      noticed: START,
      snoozedUntil: null,
      activities: { commits: "2026-11-12T08:00:00Z" },
      messageId: 100,
    });
    expect(w.net.telegram("editMessageText")[0]?.body.text).toContain(
      "<i>🔁 New commits by octocat.</i>",
    );
    expect(w.net.telegram("sendMessage")[1]?.body).toMatchObject({
      text: `🔁 <b>octocat</b> pushed new commits: <a href="${PULL}">#12 Fix it</a>`,
      message_thread_id: 900,
    });
    // GitHub's second delivery of the same push changes nothing.
    const calls = w.net.calls.length;
    expect(await apply(w.context, did("commits"))).toBe(
      "commits shown already",
    );
    expect(w.net.calls).toHaveLength(calls);
  });

  it("name new commits in a new message, which notifies by itself, when the maintainer deleted the topic", async () => {
    const w = await shown();
    withDeletedTopic(w.net, 900, [100]);
    expect(await apply(w.context, did("commits"))).toBe(
      "commits shown in a new message",
    );
    const messages = w.net.telegram("sendMessage").map((call) => call.body);
    expect(messages.map((body) => body.message_thread_id)).toEqual([
      900, 900, 901,
    ]);
    expect(messages.at(-1)?.text).toContain(
      "<i>🔁 New commits by octocat.</i>",
    );
  });

  it("notify once for a comment and the commits that follow it quickly", async () => {
    const w = await shown();
    await apply(w.context, remark(99));
    w.clock.now = START + QUIET - 1;
    expect(await apply(w.context, did("commits"))).toBe(
      "commits shown in place, quietly",
    );
    // And the other way round: a comment soon after the commits is quiet too.
    w.clock.now = START + QUIET * 2;
    expect(await apply(w.context, did("ready", "2026-11-12T09:00:00Z"))).toBe(
      "ready shown in place",
    );
    w.clock.now = START + QUIET * 2 + 1;
    expect(await apply(w.context, remark(100))).toBe(
      "comment shown in place, quietly",
    );
    // The issue, the comment and the notice of ready for review.
    expect(w.net.telegram("sendMessage")).toHaveLength(3);
    expect(w.net.telegram("sendMessage")[2]?.body.text).toBe(
      `👀 <b>octocat</b> made it ready for review: <a href="${PULL}">#12 Fix it</a>`,
    );
    // A comment says the news itself, so it takes the note of the activity away.
    expect(await thing(w)).toMatchObject({ note: null });
  });

  it("open a done thing again in its topic, keeping what its reply answers", async () => {
    const w = await shown();
    await apply(w.context, { ...remark(99), excerpt: "Please rename it" });
    await w.context.store.put({
      ...(await thing(w)),
      state: "done",
      note: "💬 You replied on GitHub, so the pager sends nothing.",
      draftVersion: 2,
      topic: { thread: 900, name: "✅ 🙋 demo#12 Fix it" },
    });
    expect(await apply(w.context, did("commits"))).toBe("commits shown anew");
    expect(await thing(w)).toMatchObject({
      state: "new",
      draft: null,
      draftVersion: 2,
      url: `${PULL}#issuecomment-99`,
      author: "hubot",
      excerpt: "Please rename it",
      comment: { id: 99, noticed: START },
      note: "🔁 New commits by octocat.",
      noticed: START,
      messageId: 102,
      topic: { thread: 900, name: "🙋 demo#12 Fix it" },
    });
    const message = w.net.telegram("sendMessage").at(-1)?.body;
    expect(message).toMatchObject({ message_thread_id: 900 });
    expect(message.text).toContain("💬 <b>New comment</b> on a pull request");
    expect(message.text).toContain("<i>🔁 New commits by octocat.</i>");
    expect(w.net.telegram("deleteMessage")).toHaveLength(0);
  });

  it("make a new thing of a pull request or an issue that the pager never showed", async () => {
    const w = await chat();
    expect(await apply(w.context, did("reopened"))).toBe("reopened shown");
    expect(await thing(w)).toMatchObject({
      state: "new",
      pull: true,
      url: PULL,
      author: "octocat",
      excerpt: "It fixes the crash",
      draftVersion: 0,
      note: "🔓 Reopened by octocat.",
      activities: { reopened: "2026-11-12T08:00:00Z" },
    });
    expect(await thing(w)).not.toHaveProperty("comment");
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "🙋 <b>New pull request</b> in",
    );
  });

  it("take an activity without its time as news each time", async () => {
    const w = await shown();
    expect(await apply(w.context, did("reopened", null))).toBe(
      "reopened shown in place",
    );
    expect(await thing(w)).not.toHaveProperty("activities");
    w.clock.now = START + QUIET;
    expect(await apply(w.context, did("reopened", null))).toBe(
      "reopened shown in place",
    );
    const fresh = await chat();
    expect(await apply(fresh.context, did("commits", null))).toBe(
      "commits shown",
    );
    expect(await thing(fresh)).not.toHaveProperty("activities");
  });

  it("forget an activity whose notice failed, so that the next delivery notifies", async () => {
    const w = await shown();
    let busy = true;
    w.net.on("POST", /\/sendMessage$/, () =>
      busy
        ? json(
            { ok: false, description: "Too Many Requests: retry after 5" },
            429,
          )
        : undefined,
    );
    const first = await thing(w);
    await expect(apply(w.context, did("commits"))).rejects.toThrow(
      "Too Many Requests",
    );
    // The thing knew of no activity and no notice before, and still knows of none.
    let after = await thing(w);
    expect(after).not.toHaveProperty("activities");
    expect(after.noticed).toBe(first.noticed);
    busy = false;
    expect(await apply(w.context, did("commits"))).toBe(
      "commits shown in place",
    );
    // A later activity whose notice fails gives back what the thing knew.
    w.clock.now = START + QUIET;
    busy = true;
    await expect(
      apply(w.context, did("reopened", "2026-11-12T09:00:00Z")),
    ).rejects.toThrow("Too Many Requests");
    after = await thing(w);
    expect(after.activities).toEqual({ commits: "2026-11-12T08:00:00Z" });
    expect(after.noticed).toBe(START);
    busy = false;
    expect(
      await apply(w.context, did("reopened", "2026-11-12T09:00:00Z")),
    ).toBe("reopened shown in place");
    expect(w.net.telegram("sendMessage").at(-1)?.body.text).toContain("Fix it");
  });

  it("keep the times of the activities when a comment opens the thing again", async () => {
    const w = await shown();
    await apply(w.context, did("commits"));
    await w.context.store.put({ ...(await thing(w)), state: "done" });
    expect(await apply(w.context, remark(99))).toBe("comment shown anew");
    expect(await thing(w)).toMatchObject({
      state: "new",
      activities: { commits: "2026-11-12T08:00:00Z" },
    });
    // So the push that a redelivery brings back changes nothing.
    expect(await apply(w.context, did("commits"))).toBe(
      "commits shown already",
    );
  });

  it("leave an ignored thing and a discussion alone", async () => {
    const w = await shown();
    await w.context.store.put({ ...(await thing(w)), state: "ignored" });
    const calls = w.net.calls.length;
    expect(await apply(w.context, did("commits"))).toBe("commits ignored");
    expect(w.net.calls).toHaveLength(calls);
    const other = await chat();
    await apply(other.context, {
      ...at,
      type: "discussion",
      number: 12,
      title: "How do I start?",
      url: "https://github.com/Dennis-Otto/demo/discussions/12",
      author: "octocat",
      node: "D_1",
    });
    expect(await apply(other.context, did("reopened"))).toBe(
      "no contribution of an issue or a pull request",
    );
  });
});

describe("the alarm of a repository", () => {
  it("bundles what fails, notifies of a new entry, edits a changed one in place and closes when all is green", async () => {
    const w = await world();
    expect(await apply(w.context, failing("check:lint"))).toBe("alarm opened");
    // A day later, with the alarm still open, the release fails: news, which a
    // message below the alarm tells, since the edit of the alarm notifies nobody.
    w.clock.now = START + 24 * 3_600_000;
    expect(await apply(w.context, failing("workflow:release"))).toBe(
      "new entry in the alarm",
    );
    const [opened, notice] = w.net.telegram("sendMessage");
    expect(notice?.body).toMatchObject({
      chat_id: opened?.body.chat_id,
      text: '🚨 New in this alarm: <a href="https://github.com/x">A bot fails: workflow:release fails</a>',
      reply_parameters: { message_id: 100 },
    });
    // It notifies, as an edit doesn't.
    expect(notice?.body).not.toHaveProperty("disable_notification");
    expect(w.net.telegram("editMessageText")[0]?.body).toMatchObject({
      message_id: 100,
    });
    // A check that fails again is no news: the alarm changes in place, quietly.
    expect(
      await apply(w.context, failing("check:lint", "lint fails again")),
    ).toBe("alarm updated");
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
    expect(w.net.telegram("editMessageText")).toHaveLength(2);
    const alarm = await stored(w, keys.alarm(REPO));
    expect(alarm).toMatchObject({
      entries: [
        { key: "check:lint", label: "A bot fails: lint fails again" },
        { key: "workflow:release" },
      ],
      noticed: START + 24 * 3_600_000,
    });
    expect(
      await apply(w.context, { ...at, type: "recovered", key: "check:other" }),
    ).toBe("not part of the alarm");
    expect(
      await apply(w.context, { ...at, type: "recovered", key: "check:lint" }),
    ).toBe("alarm updated");
    expect(
      await apply(w.context, {
        ...at,
        type: "recovered",
        key: "workflow:release",
      }),
    ).toBe("alarm closed");
    expect(await stored(w, keys.alarm(REPO))).toMatchObject({
      state: "recovered",
      entries: [],
    });
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      "✅ Green again.",
    );
    expect(await apply(w.context, { ...at, type: "recovered", key: "x" })).toBe(
      "no open alarm",
    );
    expect(await apply(w.context, failing("check:lint"))).toBe("alarm opened");
    expect(w.net.telegram("sendMessage")).toHaveLength(3);
  });

  it("takes a failed release out only with a pass that belongs to it, not with the next push that finds nothing to release", async () => {
    const w = await world();
    const key = "workflow:.github/workflows/release.yml";
    const releases = "/repos/Dennis-Otto/demo/releases?per_page=10";
    let listed: unknown[] = [{ draft: false }, { draft: true }];
    w.net.on("GET", releases, () => json(listed));
    const passed = (run: number | undefined, dispatched = false): Signal => ({
      ...at,
      type: "recovered",
      key,
      release: { ...(run === undefined ? {} : { run }), dispatched },
    });
    const entries = async () =>
      ((await stored(w, keys.alarm(REPO))) as Alarm).entries.map(
        (each) => each.key,
      );
    expect(await apply(w.context, failing(key, "Release", 3))).toBe(
      "alarm opened",
    );
    // The run of the next push passes and leaves the release a draft: it stays.
    expect(await apply(w.context, passed(4))).toBe(
      "a pass that leaves a release a draft",
    );
    expect(await entries()).toEqual([key]);
    // The draft is listed only to a token that may write the contents.
    expect(w.net.github("/access_tokens").at(-1)?.body.permissions).toEqual({
      contents: "write",
    });
    // Releases that can't be read keep it as well.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    w.net.on("GET", releases, () => json({ message: "Server Error" }, 500));
    expect(await apply(w.context, passed(4))).toBe(
      "a pass of a release whose releases can't be read",
    );
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
    expect(await entries()).toEqual([key]);
    // A later attempt of the run that failed takes it out, without a read.
    const read = w.net.github(releases).length;
    expect(await apply(w.context, passed(3))).toBe("alarm closed");
    expect(w.net.github(releases)).toHaveLength(read);
    // A run by hand takes up the draft and takes the entry out, without a read.
    await apply(w.context, failing(key, "Release", 5));
    expect(await apply(w.context, passed(6, true))).toBe("alarm closed");
    expect(w.net.github(releases)).toHaveLength(read);
    // Any pass after which no release is a draft takes it out, also of an
    // entry that names no run.
    listed = [{ draft: false }, {}];
    w.net.on("GET", releases, () => json(listed));
    await apply(w.context, failing(key, "Release"));
    expect(await apply(w.context, passed(7))).toBe("alarm closed");
    await apply(w.context, failing(key, "Release", 8));
    expect(await apply(w.context, passed(undefined))).toBe("alarm closed");
    // Without an open alarm, or with the entry not part of it, nothing is read.
    const after = w.net.github(releases).length;
    expect(await apply(w.context, passed(9))).toBe("no open alarm");
    await apply(w.context, failing("check:lint"));
    expect(await apply(w.context, passed(9))).toBe("not part of the alarm");
    expect(w.net.github(releases)).toHaveLength(after);
    // An error that isn't one of GitHub is no answer of the releases.
    await apply(w.context, failing(key, "Release", 10));
    w.context.github.draftRelease = () => Promise.reject(new TypeError("boom"));
    await expect(apply(w.context, passed(11))).rejects.toThrow("boom");
  });

  it("notifies of a burst of new entries once, and brings a snoozed alarm back with a new one", async () => {
    const w = await world();
    const alarmOf = async () => (await stored(w, keys.alarm(REPO))) as Alarm;
    await apply(w.context, failing("check:lint"));
    // The opening message notified already: what joins it within QUIET comes quietly.
    expect(await apply(w.context, failing("check:test"))).toBe(
      "new entry in the alarm, quietly",
    );
    w.clock.now = START + QUIET - 1;
    expect(await apply(w.context, failing("check:build"))).toBe(
      "new entry in the alarm, quietly",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    expect(w.net.telegram("editMessageText")).toHaveLength(2);
    expect(await alarmOf()).toMatchObject({ noticed: START });
    // "Later" put the alarm aside: a new failure brings it back at once, and notifies.
    const snoozed = await alarmOf();
    snoozed.snoozedUntil = START + 4 * 3_600_000;
    await w.context.store.put(snoozed);
    w.clock.now = START + QUIET;
    expect(await apply(w.context, failing("workflow:release"))).toBe(
      "new entry in the alarm",
    );
    expect(await alarmOf()).toMatchObject({
      snoozedUntil: null,
      noticed: START + QUIET,
    });
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).not.toContain(
      "⏰",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
    // A record from before the notices knows of none: its next new entry notifies.
    const older = await alarmOf();
    delete older.noticed;
    await w.context.store.put(older);
    expect(await apply(w.context, failing("check:docs"))).toBe(
      "new entry in the alarm",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(3);
    expect(w.net.telegram("sendMessage").at(-1)?.body.text).toContain(
      "🚨 New in this alarm: ",
    );
  });

  it("sends no notice when the message of the alarm is gone, since the new one notified", async () => {
    const w = await world();
    await apply(w.context, failing("check:lint"));
    w.net.on("POST", /editMessageText$/, () =>
      json(
        { ok: false, description: "Bad Request: message to edit not found" },
        400,
      ),
    );
    w.clock.now = START + QUIET;
    expect(await apply(w.context, failing("workflow:release"))).toBe(
      "new entry in the alarm, in a new message",
    );
    const sent = w.net.telegram("sendMessage");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body.text).toContain("workflow:release fails");
    expect(sent[1]?.body.text).not.toContain("New in this alarm");
  });

  it("forgets a new entry whose notice failed, so that the next delivery notifies", async () => {
    const w = await world();
    const alarmOf = async () => (await stored(w, keys.alarm(REPO))) as Alarm;
    let busy = false;
    w.net.on("POST", /\/sendMessage$/, () =>
      busy
        ? json(
            { ok: false, description: "Too Many Requests: retry after 5" },
            429,
          )
        : undefined,
    );
    await apply(w.context, failing("check:lint"));
    w.clock.now = START + QUIET;
    busy = true;
    await expect(apply(w.context, failing("workflow:release"))).rejects.toThrow(
      "Too Many Requests",
    );
    expect(await alarmOf()).toMatchObject({
      entries: [{ key: "check:lint" }],
      noticed: START,
    });
    // GitHub delivers the event again, and the notice goes this time.
    busy = false;
    expect(await apply(w.context, failing("workflow:release"))).toBe(
      "new entry in the alarm",
    );
    expect(w.net.telegram("sendMessage").at(-1)?.body.text).toContain(
      "🚨 New in this alarm: ",
    );
    // A record from before the notices knows of none, and still knows of none.
    const older = await alarmOf();
    delete older.noticed;
    await w.context.store.put(older);
    busy = true;
    await expect(apply(w.context, failing("check:docs"))).rejects.toThrow(
      "Too Many Requests",
    );
    const after = await alarmOf();
    expect(after).not.toHaveProperty("noticed");
    expect(after.entries.map((each) => each.key)).toEqual([
      "check:lint",
      "workflow:release",
    ]);
  });

  it("keeps the run of an entry, follows it and writes only what changed", async () => {
    const w = await world();
    const bot = (type: "failing" | "still-failing", run: number) =>
      failing("issue:5", "CI fails on main", run, type);
    expect(await apply(w.context, bot("still-failing", 31))).toBe(
      "no open alarm",
    );
    expect(await apply(w.context, bot("failing", 31))).toBe("alarm opened");
    expect(await apply(w.context, bot("failing", 31))).toBe("alarm unchanged");
    expect(await apply(w.context, bot("still-failing", 31))).toBe(
      "alarm unchanged",
    );
    expect(w.net.telegram("editMessageText")).toHaveLength(0);
    expect(await apply(w.context, bot("still-failing", 32))).toBe(
      "alarm updated",
    );
    expect(
      await apply(w.context, failing("issue:6", "x", 40, "still-failing")),
    ).toBe("not part of the alarm");
    expect(await stored(w, keys.alarm(REPO))).toMatchObject({
      entries: [{ key: "issue:5", run: 32 }],
    });
    // A check of another app names no run.
    w.net.on("GET", /\/rules\/branches\/main$/, () =>
      json([
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "lint" }] },
        },
      ]),
    );
    await apply(w.context, {
      ...at,
      type: "check",
      name: "lint",
      failed: true,
      branch: "main",
      url: `https://github.com/${REPO}/runs/1`,
    });
    const entries = ((await stored(w, keys.alarm(REPO))) as Alarm).entries;
    expect(entries).toMatchObject([{ run: 32 }, { key: "check:lint" }]);
    expect(entries[1]?.run).toBeUndefined();
    // The last entry goes: the alarm is closed, and an edit opens nothing.
    for (const key of ["issue:5", "check:lint"]) {
      await apply(w.context, { ...at, type: "recovered", key });
    }
    expect(await apply(w.context, bot("still-failing", 33))).toBe(
      "no open alarm",
    );
  });

  it("shows a rerun until its entry fails again or passes", async () => {
    const w = await world();
    const id = await itemId(keys.alarm(REPO));
    const entry = (key: string, run: number) => ({
      key,
      label: `${key} fails`,
      url: `https://github.com/${REPO}/issues/5`,
      run,
      rerun: true as const,
    });
    await show(w.context, {
      id,
      ...at,
      kind: "alarm",
      state: "open",
      messageId: null,
      note: null,
      snoozedUntil: null,
      entries: [entry("issue:5", 31), entry("workflow:release", 40)],
    });
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "issue:5 fails</a> — 🔁 running again…",
    );
    // The rerun of the release failed: its entry shows the failure again.
    expect(
      await apply(w.context, failing("workflow:release", "release", 40)),
    ).toBe("alarm updated");
    const text = w.net.telegram("editMessageText")[0]?.body.text as string;
    expect(text).toContain("issue:5 fails</a> — 🔁 running again…");
    expect(text).toMatch(/A bot fails: release<\/a>$/);
    expect(text.match(/running again/g)).toHaveLength(1);
    // The rerun of the bot passed: the bot-health bot closes its issue.
    await apply(w.context, { ...at, type: "recovered", key: "issue:5" });
    await apply(w.context, {
      ...at,
      type: "recovered",
      key: "workflow:release",
    });
    const green = w.net.telegram("editMessageText").at(-1)?.body.text;
    expect(green).toContain("✅ Green again.");
    expect(green).not.toContain("running again");
    expect(await stored(w, keys.alarm(REPO))).toMatchObject({
      state: "recovered",
    });
  });

  it("counts only the checks that the rules of the branch require", async () => {
    const w = await world();
    w.net.on("GET", "/repos/Dennis-Otto/demo/rules/branches/main", () =>
      json([
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "lint" }] },
        },
      ]),
    );
    const check = (name: string, failed: boolean): Signal => ({
      ...at,
      type: "check",
      name,
      failed,
      branch: "main",
      url: "https://github.com/run",
    });
    expect(await apply(w.context, check("docs", true))).toBe(
      "a check that no rule requires",
    );
    expect(await apply(w.context, check("lint", true))).toBe("alarm opened");
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "lint fails on main",
    );
    expect(await apply(w.context, check("lint", false))).toBe("alarm closed");
  });

  it("offers no Start fix for the upload of the social preview, which only a person can make, and leaves it out of a fix", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    const issue = `https://github.com/${REPO}/issues/123`;
    const upload: Signal = {
      ...at,
      type: "failing",
      key: "issue:123",
      label: { key: "entry.preview" },
      url: issue,
      upload: true,
    };
    expect(await apply(w.context, upload)).toBe("alarm opened");
    expect(((await stored(w, keys.alarm(REPO))) as Alarm).entries).toEqual([
      {
        key: "issue:123",
        label: "🖼 Upload the new social preview",
        url: issue,
        upload: true,
      },
    ]);
    expect(
      w.net
        .telegram("sendMessage")[0]
        ?.body.reply_markup.inline_keyboard.flat()
        .map((button: { text: string }) => button.text),
    ).toEqual(["⏰ Later", "✖ Ignore"]);
    expect(await apply(w.context, { ...upload, type: "still-failing" })).toBe(
      "alarm unchanged",
    );
    // A bot that fails as well brings 🛠 Start fix back, which sends that bot alone.
    await apply(w.context, failing("issue:5", "CI fails on main"));
    const both = (await stored(w, keys.alarm(REPO))) as Alarm;
    expect(allowed(both)).toEqual(["fix", "later", "ignore"]);
    await press(w.context, both, { action: "fix", id: both.id, version: null });
    expect(w.net.github("/dispatches")[0]?.body.client_payload.entries).toEqual(
      [{ label: "A bot fails: CI fails on main", url: "https://github.com/x" }],
    );
    // The bot closes its issue once GitHub shows the picture: the entry leaves.
    expect(
      await apply(w.context, { ...at, type: "recovered", key: "issue:123" }),
    ).toBe("alarm updated");
    expect(
      ((await stored(w, keys.alarm(REPO))) as Alarm).entries,
    ).toMatchObject([{ key: "issue:5" }]);
  });

  it("marks the entry of an upload that it kept before the mark, by the label that it gave it", async () => {
    const w = await world();
    const id = await itemId(keys.alarm(REPO));
    const entry = (number: number, label: string) => ({
      key: `issue:${number}`,
      label,
      url: `https://github.com/${REPO}/issues/${number}`,
    });
    // The entries of the social preview as pagers kept them up to 0.8.1, in
    // English and in German: since 0.8.1 by what to do, before as a bot that fails.
    const kept: Alarm = {
      ...base(id),
      kind: "alarm",
      state: "open",
      entries: [
        entry(1, "🖼 Upload the new social preview"),
        entry(2, "🖼 Lade die neue Social Preview hoch"),
        entry(3, "A bot fails: Upload the new social preview"),
        entry(4, "Ein Bot scheitert: Upload the new social preview"),
      ],
    };
    await w.context.store.put(kept);
    const read = (await w.context.store.get(id)) as Alarm;
    expect(read.entries.map((each) => each.upload)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(allowed(read)).toEqual(["later", "ignore"]);
    // Every other entry stays as it was, and with it 🛠 Start fix.
    const other = entry(5, "A bot fails: CI fails on main");
    await w.context.store.put({ ...kept, entries: [...kept.entries, other] });
    const mixed = (await w.context.store.get(id)) as Alarm;
    expect(mixed.entries[4]).toEqual(other);
    expect(allowed(mixed)).toEqual(["fix", "later", "ignore"]);
    // The closing of an issue takes its entry out by its key, as before, and the
    // record keeps the mark from its next write on.
    expect(
      await apply(w.context, { ...at, type: "recovered", key: "issue:5" }),
    ).toBe("alarm updated");
    expect(await env.PAGER.get(`item:${id}`, "json")).toMatchObject({
      entries: [1, 2, 3, 4].map((number) => ({
        key: `issue:${number}`,
        upload: true,
      })),
    });
    const message = w.net.telegram("editMessageText")[0]?.body;
    expect(
      message.reply_markup.inline_keyboard
        .flat()
        .map((button: { text: string }) => button.text),
    ).toEqual(["⏰ Later", "✖ Ignore"]);
  });
});

describe("code-scanning alerts", () => {
  it("are bundled per repository and resolve one by one", async () => {
    const w = await world();
    const open = (key: string): Signal => ({
      ...at,
      type: "alert-open",
      key,
      label: { key: "entry.alert", values: { severity: "high", what: key } },
      url: "https://github.com/a",
    });
    expect(await apply(w.context, open("alert:1"))).toBe("alert opened");
    // A burst of alerts, such as from a new query, notifies once.
    expect(await apply(w.context, open("alert:2"))).toBe(
      "new entry in the alert, quietly",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    // One that comes later, while the others wait for their fix, notifies.
    w.clock.now = START + QUIET;
    expect(await apply(w.context, open("alert:3"))).toBe(
      "new entry in the alert",
    );
    expect(w.net.telegram("sendMessage").at(-1)?.body).toMatchObject({
      text: '🛡 New in this security message: <a href="https://github.com/a">high: alert:3</a>',
      reply_parameters: { message_id: 100 },
    });
    expect(await apply(w.context, open("alert:3"))).toBe("alert unchanged");
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
    for (const key of ["alert:1", "alert:2"]) {
      expect(await apply(w.context, { ...at, type: "alert-closed", key })).toBe(
        "alert updated",
      );
    }
    expect(
      await apply(w.context, { ...at, type: "alert-closed", key: "alert:3" }),
    ).toBe("alert closed");
    expect(await stored(w, keys.alert(REPO))).toMatchObject({
      state: "resolved",
    });
  });
});

describe("a release", () => {
  const pull = {
    number: 30,
    state: "open",
    title: "chore: release 1.2.3",
    draft: false,
    mergeable_state: "clean",
    html_url: "https://github.com/Dennis-Otto/demo/pull/30",
    head: {
      ref: "release-please--branches--main",
      sha: "abc",
      repo: { full_name: "Dennis-Otto/demo" },
    },
    base: {
      ref: "main",
      repo: { full_name: "Dennis-Otto/demo", default_branch: "main" },
    },
  };
  const check: Signal = { ...at, type: "release-check", numbers: [30] };

  function serve(w: World, answer: object = pull): void {
    w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () => json(answer));
  }

  it("pages once it is ready, and follows it until it is published", async () => {
    const w = await world();
    serve(w, { ...pull, mergeable_state: "blocked" });
    expect(await apply(w.context, check)).toBe(
      "#30 not ready: its checks aren't all green (blocked)",
    );
    serve(w);
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(await apply(w.context, check)).toBe("#30 shown already");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);

    expect(
      await apply(w.context, {
        ...at,
        type: "release-updated",
        number: 30,
        sha: "abc",
      }),
    ).toBe("release unchanged");
    expect(
      await apply(w.context, {
        ...at,
        type: "release-updated",
        number: 30,
        sha: "def",
      }),
    ).toBe("release updating");
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      state: "updating",
      sha: "def",
    });
    serve(w, { ...pull, head: { ...pull.head, sha: "def" } });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);

    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 31 }),
    ).toBe("release unchanged");
    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 30 }),
    ).toBe("release merged");
    expect(
      await apply(w.context, {
        ...at,
        type: "release-published",
        tag: "v1.2.2",
      }),
    ).toBe("release unchanged");
    expect(
      await apply(w.context, {
        ...at,
        type: "release-published",
        tag: "v1.2.3",
      }),
    ).toBe("release published");
    expect(
      await apply(w.context, {
        ...at,
        type: "release-published",
        tag: "v1.2.3",
      }),
    ).toBe("release unchanged");
    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 30 }),
    ).toBe("release unchanged");
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      state: "published",
    });
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      "✅ Published.",
    );
    // A published release with the same version stays published.
    serve(w);
    expect(await apply(w.context, check)).toBe("#30 shown already");
  });

  it("shows the notes of the release, and reads them again when they change", async () => {
    const w = await world();
    const body = (item: string) =>
      `The next release.\n\n${NOTES_MARK}\n---\n\n## [1.2.3](https://github.com/Dennis-Otto/demo/compare/v1.2.2...v1.2.3) (2026-11-08)\n\n### Features\n\n* ${item} ([#28](https://github.com/Dennis-Otto/demo/issues/28)) ([abc1234](https://github.com/Dennis-Otto/demo/commit/abc1234))\n\n---\nThis PR was generated with Release Please.`;
    serve(w, { ...pull, body: body("a <b>new</b> button") });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      notes: {
        lines: [{ heading: "Features" }, { item: "a <b>new</b> button #28" }],
        more: 0,
        breaking: false,
      },
    });
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      '<b>Features</b>\n• a &lt;b&gt;new&lt;/b&gt; button <a href="https://github.com/Dennis-Otto/demo/issues/28">#28</a>\n\nEvery check is green',
    );
    // The same head with the same notes, such as after a marker of the release bot.
    serve(w, {
      ...pull,
      body: `${body("a <b>new</b> button")}\n\n<!-- rebuild -->`,
    });
    expect(await apply(w.context, check)).toBe("#30 shown already");
    // Notes changed by hand: the message shows them, in place.
    serve(w, { ...pull, body: body("a better button") });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      "• a better button",
    );
    // A body without notes leaves none in the record.
    serve(w, { ...pull, body: "No notes here." });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(await stored(w, keys.release(REPO))).not.toHaveProperty("notes");
  });

  it("keeps its record small in Workers KV, with the longest notes", async () => {
    const w = await world();
    // Three bytes of UTF-8 for each character: the largest notes that fit.
    const many = Array.from(
      { length: 200 },
      (_, n) =>
        `* ${"€".repeat(400)} ([#${n}](https://github.com/Dennis-Otto/demo/issues/${n})) ([abc1234](https://github.com/Dennis-Otto/demo/commit/abc1234))`,
    ).join("\n");
    serve(w, { ...pull, body: `${NOTES_MARK}\n---\n### Features\n${many}` });
    await apply(w.context, check);
    const release = (await stored(w, keys.release(REPO))) as Release;
    const { notes: _notes, ...before } = release;
    expect(bytes(before)).toBeLessThan(600);
    expect(bytes(release) - bytes(before)).toBeLessThan(4000);
  });

  it("stays quiet about a release that was ignored, and pages for the next one", async () => {
    const w = await world();
    serve(w);
    await apply(w.context, check);
    const item = (await stored(w, keys.release(REPO))) as Item & {
      state: string;
    };
    item.state = "ignored";
    await w.context.store.put(item);
    expect(await apply(w.context, check)).toBe("#30 ignored");
    serve(w, { ...pull, title: "chore: release 1.3.0" });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
  });

  it("replaces the message of a release whose version changed while it was shown", async () => {
    const w = await world();
    serve(w);
    expect(await apply(w.context, check)).toBe("#30 ready");
    const first = (await stored(w, keys.release(REPO)))?.messageId;
    serve(w, {
      ...pull,
      title: "chore: release 1.3.0",
      head: { ...pull.head, sha: "def" },
    });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
    expect(w.net.telegram("deleteMessage")).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ message_id: first }),
      }),
    ]);
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      version: "1.3.0",
      sha: "def",
      state: "ready",
    });
  });

  it("knows no release that it never showed", async () => {
    const w = await world();
    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 30 }),
    ).toBe("no release shown");
    await w.context.store.put({
      id: await itemId(keys.release(REPO)),
      kind: "alarm",
      state: "open",
      repo: REPO,
      installation: 9,
      messageId: null,
      note: null,
      snoozedUntil: null,
      entries: [],
    });
    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 30 }),
    ).toBe("no release shown");
  });

  it("asks again while GitHub works out whether it can merge", async () => {
    const w = await world();
    let asked = 0;
    w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () => {
      asked += 1;
      return json(asked < 3 ? { ...pull, mergeable_state: "unknown" } : pull);
    });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.sleeps).toEqual([2000, 4000]);
    const never = await world();
    never.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () =>
      json({ ...pull, mergeable_state: "unknown" }),
    );
    expect(await apply(never.context, check)).toBe(
      "#30 not ready: its checks aren't all green (unknown)",
    );
    expect(never.sleeps).toHaveLength(2);
  });

  it("reads a pull request without its fields as not ready", async () => {
    const w = await world();
    serve(w, {
      number: 30,
      state: "open",
      head: { ref: "release-please--x" },
      base: {},
    });
    expect(await apply(w.context, check)).toBe(
      "#30 not ready: it doesn't go into main",
    );
  });

  it("shows no release of a fork that names its branch like release-please", async () => {
    const w = await world();
    serve(w, {
      ...pull,
      head: { ...pull.head, repo: { full_name: "mallory/demo" } },
    });
    expect(await apply(w.context, check)).toBe(
      "#30 not ready: it comes from a fork",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(0);
  });

  it("takes a ready pull request without a head or address as it comes", async () => {
    const w = await world();
    const { html_url: _url, head: _head, ...bare } = pull;
    // A ready pull request always has its head; the rule reads the branch from it.
    serve(w, {
      ...bare,
      head: { ref: "release-please--branches--main", repo: pull.head.repo },
    });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      sha: "",
      url: "",
    });
  });
});

describe("showing a thing", () => {
  it("sends a new message when the old one is gone, and replaces it when fresh", async () => {
    const w = await world();
    w.net.on("POST", /editMessageText$/, () =>
      json(
        { ok: false, description: "Bad Request: message to edit not found" },
        400,
      ),
    );
    const item: Item = {
      id: "i0123456789abcde",
      kind: "reminder",
      state: "open",
      repo: REPO,
      installation: 0,
      messageId: 5,
      note: null,
      snoozedUntil: null,
      text: "Hello",
    };
    await show(w.context, item);
    expect(item.messageId).toBe(100);
    expect(w.net.telegram("deleteMessage")).toHaveLength(0);
    await show(w.context, item, true);
    expect(item.messageId).toBe(101);
    expect(w.net.telegram("deleteMessage")[0]?.body.message_id).toBe(100);
  });
});
