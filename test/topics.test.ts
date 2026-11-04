// The topics of the chat: one per thing, which its first message opens, renamed with
// ✅ once the thing is done and kept; the main view when the chat has none or
// Telegram refuses one; and a text in the topic of a thing, which goes to the
// control repository together with that thing.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { handleControl } from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import { apply, show } from "../src/pager.ts";
import type { Signal } from "../src/rules.ts";
import { runSchedule } from "../src/schedule.ts";
import {
  type Alarm,
  type Alert,
  type Contribution,
  type Item,
  itemId,
  keys,
  type Release,
  type Reminder,
} from "../src/store.ts";
import { Telegram, TOPIC_COLORS } from "../src/telegram.ts";
import { texts } from "../src/texts.ts";
import {
  about,
  cut,
  isDone,
  MAX_ABOUT,
  MAX_LINKS,
  MAX_TOPIC_NAME,
  topicName,
} from "../src/topics.ts";
import { handleUpdate } from "../src/updates.ts";
import {
  base,
  CHAT,
  json,
  Net,
  REPO,
  START,
  type World,
  withControl,
  withTopics,
  world,
} from "./helpers.ts";

const ID = "i0123456789abcde";
const at = { repo: REPO, installation: 9 };
const PULL_URL = "https://github.com/Dennis-Otto/demo/pull/30";

const contribution: Signal = {
  ...at,
  type: "contribution",
  number: 12,
  pull: false,
  title: "It breaks",
  url: "https://github.com/Dennis-Otto/demo/issues/12",
  author: "octocat",
};

function failing(key: string): Signal {
  return {
    ...at,
    type: "failing",
    key,
    label: { key: "entry.bot", values: { title: `${key} fails` } },
    url: `https://github.com/${REPO}/actions/runs/1`,
  };
}

const release: Release = {
  ...base(ID),
  kind: "release",
  state: "ready",
  number: 30,
  version: "1.2.3",
  sha: "abc",
  url: PULL_URL,
};

const alarm: Alarm = {
  ...base(ID),
  kind: "alarm",
  state: "open",
  entries: [
    {
      key: "check:lint",
      label: "lint fails",
      url: `https://github.com/${REPO}/actions/runs/1`,
    },
  ],
};

const alert: Alert = { ...alarm, kind: "alert", state: "open" };

const reminder: Reminder = {
  ...base(ID),
  repo: "Dennis-Otto/control",
  kind: "reminder",
  state: "open",
  text: "Renew the token.",
};

function issue(extra: Partial<Contribution> = {}): Contribution {
  return {
    ...base(ID),
    kind: "contribution",
    state: "new",
    number: 12,
    pull: false,
    title: "It breaks",
    url: "https://github.com/Dennis-Otto/demo/issues/12",
    author: "octocat",
    draft: null,
    draftVersion: 0,
    ...extra,
  };
}

async function stored(w: World, key: string): Promise<Item | null> {
  return w.context.store.get(await itemId(key));
}

/** The bodies of the messages that the pager sent. */
const sent = (w: World) => w.net.telegram("sendMessage").map((c) => c.body);

/** The names of the topics that the pager opened or renamed, by method. */
const names = (w: World, method: string) =>
  w.net.telegram(method).map((call) => call.body.name);

/** The links of topics to their things, as Workers KV keeps them. */
const links = async () => (await env.PAGER.list({ prefix: "topic:" })).keys;

function text(words: string, extra: object = {}) {
  return {
    message: {
      message_id: 500,
      chat: { id: CHAT },
      from: { id: CHAT },
      text: words,
      ...extra,
    },
  };
}

/** A world whose chat has topics, and whose control repository takes texts. */
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

const refused = (description: string) => () =>
  json({ ok: false, description }, 400);

describe("a topic per thing", () => {
  it("opens with the first message of a thing, which goes into it", async () => {
    const w = await chat();
    expect(await apply(w.context, contribution)).toBe("contribution shown");
    expect(w.net.telegram("createForumTopic").map((c) => c.body)).toEqual([
      {
        chat_id: CHAT,
        name: "🙋 demo#12 It breaks",
        icon_color: TOPIC_COLORS.blue,
      },
    ]);
    expect(sent(w).map((body) => body.message_thread_id)).toEqual([900]);
    const item = await stored(w, keys.contribution(REPO, 12));
    expect(item).toMatchObject({
      messageId: 100,
      topic: { thread: 900, name: "🙋 demo#12 It breaks" },
    });
    expect((await w.context.store.byTopic(900))?.id).toBe(item?.id);
    expect(await w.context.store.byTopic(901)).toBeNull();
    // An open thing's link stays as long as the thing.
    expect((await links())[0]?.expiration).toBeUndefined();
  });

  it("is named after the repository and the thing, in the language of the pager", async () => {
    const things: Item[] = [alarm, alert, release, reminder].map((each) => ({
      ...each,
      messageId: null,
    }));
    const expected = {
      en: [
        "🚨 demo needs you",
        "🛡 Code scanning in demo",
        "📦 demo 1.2.3",
        "🔔 Token of Claude",
      ],
      de: [
        "🚨 demo braucht dich",
        "🛡 Code Scanning in demo",
        "📦 demo 1.2.3",
        "🔔 Claude-Token",
      ],
    };
    for (const language of ["en", "de"] as const) {
      const w = await world({ language });
      withTopics(w.net);
      for (const thing of things) {
        await show(w.context, structuredClone(thing));
      }
      expect(names(w, "createForumTopic")).toEqual(expected[language]);
      expect(
        w.net.telegram("createForumTopic").map((c) => c.body.icon_color),
      ).toEqual([
        TOPIC_COLORS.red,
        TOPIC_COLORS.yellow,
        TOPIC_COLORS.green,
        TOPIC_COLORS.violet,
      ]);
      // getMe is asked once per request.
      expect(w.net.telegram("getMe")).toHaveLength(1);
    }
  });

  it("cuts a long name between two characters, on one line", () => {
    const t = texts("en");
    const name = topicName(
      issue({ title: `Crash\n  on   start ${"😀".repeat(80)}` }),
      t,
    );
    expect(name.length).toBeLessThanOrEqual(MAX_TOPIC_NAME);
    expect(name.startsWith("🙋 demo#12 Crash on start 😀")).toBe(true);
    expect(name.endsWith("😀…")).toBe(true);
    expect(cut("short", 10)).toBe("short");
    expect(cut("abcdef", 4)).toBe("abc…");
    // An emoji is two characters of UTF-16, which stay together.
    expect(cut("a😀b", 3)).toBe("a…");
  });

  it("gets ✅ once its thing is done: closed, or a merged release", () => {
    const t = texts("en");
    const done: Item[] = [
      issue({ state: "sent" }),
      issue({ state: "ignored" }),
      { ...alarm, state: "recovered" },
      { ...alert, state: "resolved" },
      { ...release, state: "merged" },
      { ...release, state: "published" },
      { ...reminder, state: "done" },
    ];
    const open: Item[] = [
      issue({ state: "draft" }),
      { ...alarm, state: "fixing" },
      { ...release, state: "merging" },
      reminder,
    ];
    expect(done.map(isDone)).toEqual(done.map(() => true));
    expect(open.map(isDone)).toEqual(open.map(() => false));
    expect(topicName({ ...release, state: "merged" }, t)).toBe(
      "✅ 📦 demo 1.2.3",
    );
    expect(topicName({ ...alarm, state: "recovered" }, texts("de"))).toBe(
      "✅ 🚨 demo braucht dich",
    );
  });

  it("keeps its message, edited in place, without a second topic", async () => {
    const w = await chat();
    await apply(w.context, failing("check:lint"));
    await apply(w.context, failing("workflow:release"));
    expect(w.net.telegram("createForumTopic")).toHaveLength(1);
    expect(sent(w)).toHaveLength(1);
    expect(w.net.telegram("editMessageText")).toHaveLength(1);
    expect(w.net.telegram("editForumTopic")).toHaveLength(0);
  });

  it("marks a done bundle with ✅, and opens it again in the same topic", async () => {
    const w = await chat();
    await apply(w.context, failing("check:lint"));
    await apply(w.context, { ...at, type: "recovered", key: "check:lint" });
    expect(w.net.telegram("editForumTopic").map((c) => c.body)).toEqual([
      { chat_id: CHAT, message_thread_id: 900, name: "✅ 🚨 demo needs you" },
    ]);
    // The link of a done thing expires with its record.
    expect((await links())[0]?.expiration).toBeGreaterThan(START / 1000);
    expect(await apply(w.context, failing("check:lint"))).toBe("alarm opened");
    expect(w.net.telegram("createForumTopic")).toHaveLength(1);
    expect(sent(w).map((body) => body.message_thread_id)).toEqual([900, 900]);
    expect(names(w, "editForumTopic")).toEqual([
      "✅ 🚨 demo needs you",
      "🚨 demo needs you",
    ]);
    expect((await links())[0]?.expiration).toBeUndefined();
    expect((await stored(w, keys.alarm(REPO)))?.topic).toEqual({
      thread: 900,
      name: "🚨 demo needs you",
    });
  });

  it("follows a release: a new version renames it, and the next release gets its own", async () => {
    const w = await chat();
    const pull = {
      number: 30,
      state: "open",
      title: "chore: release 1.2.3",
      draft: false,
      mergeable_state: "clean",
      html_url: PULL_URL,
      head: { ref: "release-please--branches--main", sha: "abc" },
      base: { ref: "main", repo: { default_branch: "main" } },
    };
    const serve = (answer: object) =>
      w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () => json(answer));
    const check: Signal = { ...at, type: "release-check", numbers: [30] };
    serve(pull);
    expect(await apply(w.context, check)).toBe("#30 ready");
    serve({
      ...pull,
      title: "chore: release 1.3.0",
      head: { ...pull.head, sha: "def" },
    });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(names(w, "createForumTopic")).toEqual(["📦 demo 1.2.3"]);
    expect(names(w, "editForumTopic")).toEqual(["📦 demo 1.3.0"]);
    expect(sent(w).map((body) => body.message_thread_id)).toEqual([900, 900]);
    await apply(w.context, { ...at, type: "release-merged", number: 30 });
    await apply(w.context, { ...at, type: "release-published", tag: "1.3.0" });
    expect(names(w, "editForumTopic")).toEqual([
      "📦 demo 1.3.0",
      "✅ 📦 demo 1.3.0",
    ]);
    serve({
      ...pull,
      title: "chore: release 1.4.0",
      head: { ...pull.head, sha: "ghi" },
    });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(names(w, "createForumTopic")).toEqual([
      "📦 demo 1.2.3",
      "📦 demo 1.4.0",
    ]);
    expect(sent(w).at(-1)?.message_thread_id).toBe(901);
    // The topic of the release before stays, and a text in it has no thing.
    expect(await w.context.store.byTopic(900)).toBeNull();
    expect((await w.context.store.byTopic(901))?.kind).toBe("release");
  });

  it("brings a thing back into its topic when its Later is over", async () => {
    const w = await chat();
    await apply(w.context, contribution);
    const item = (await stored(w, keys.contribution(REPO, 12))) as Item;
    item.snoozedUntil = START;
    await w.context.store.put(item);
    w.clock.now = START + 1;
    await runSchedule(w.context);
    expect(sent(w).map((body) => body.message_thread_id)).toEqual([900, 900]);
    expect(w.net.telegram("createForumTopic")).toHaveLength(1);
    expect(
      w.net.telegram("deleteMessage").map((c) => c.body.message_id),
    ).toEqual([100]);
  });

  it("asks for an edit in the topic of the draft, or in reply to its message", async () => {
    const w = await world();
    const drafted = issue({
      state: "draft",
      draft: "Thanks!",
      draftVersion: 1,
      topic: { thread: 900, name: "🙋 demo#12 It breaks" },
    });
    const press = async (item: Contribution) => {
      await w.context.store.put(item);
      await handleUpdate(w.context, {
        callback_query: { id: "q", from: { id: CHAT }, data: `edit:${ID}` },
      });
    };
    await press(drafted);
    await press({ ...drafted, topic: null });
    const [inTopic, inMain] = sent(w);
    expect(inTopic).toMatchObject({
      message_thread_id: 900,
      reply_markup: { force_reply: true },
    });
    expect(inTopic).not.toHaveProperty("reply_parameters");
    expect(inMain).toMatchObject({
      reply_parameters: { message_id: 7, allow_sending_without_reply: true },
    });
    expect(inMain).not.toHaveProperty("message_thread_id");
  });
});

describe("without topics", () => {
  it("keeps a thing in the main view when the chat has none", async () => {
    const w = await world();
    w.net.on("POST", /\/getMe$/, () =>
      json({ ok: true, result: { id: 1, has_topics_enabled: false } }),
    );
    await apply(w.context, contribution);
    await apply(w.context, failing("check:lint"));
    expect(w.net.telegram("createForumTopic")).toHaveLength(0);
    expect(sent(w).map((body) => "message_thread_id" in body)).toEqual([
      false,
      false,
    ]);
    expect((await stored(w, keys.contribution(REPO, 12)))?.topic).toBeNull();
    expect(w.net.telegram("getMe")).toHaveLength(1);
    expect(await links()).toEqual([]);
  });

  it("keeps a thing in the main view when Telegram refuses its topic", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const w = await chat();
    w.net.on(
      "POST",
      /\/createForumTopic$/,
      refused("Bad Request: CHAT_NOT_FORUM"),
    );
    await apply(w.context, contribution);
    expect(sent(w)[0]).not.toHaveProperty("message_thread_id");
    expect((await stored(w, keys.contribution(REPO, 12)))?.topic).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Telegram createForumTopic: Bad Request: CHAT_NOT_FORUM; sent to the main view",
    );
    // The log leaves out the name, which quotes the title of the issue.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("It breaks");
    warn.mockRestore();
  });

  it("deletes a new topic that takes no message, and goes on in the main view", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const w = await chat();
    let tries = 0;
    w.net.on("POST", /\/sendMessage$/, () =>
      tries++ === 0
        ? refused("Bad Request: message thread not found")()
        : json({ ok: true, result: { message_id: 7 } }),
    );
    await apply(w.context, contribution);
    expect(w.net.telegram("deleteForumTopic").map((c) => c.body)).toEqual([
      { chat_id: CHAT, message_thread_id: 900 },
    ]);
    expect(await stored(w, keys.contribution(REPO, 12))).toMatchObject({
      messageId: 7,
      topic: null,
    });
    expect(await links()).toEqual([]);
    warn.mockRestore();
  });

  it("goes on in the main view when the topic of a thing is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const w = await chat();
    await apply(w.context, contribution);
    const item = (await stored(w, keys.contribution(REPO, 12))) as Item;
    let tries = 0;
    w.net.on("POST", /\/sendMessage$/, () =>
      tries++ === 0
        ? refused("Bad Request: message thread not found")()
        : json({ ok: true, result: { message_id: 8 } }),
    );
    await show(w.context, item, true);
    expect(w.net.telegram("deleteForumTopic")).toHaveLength(0);
    expect(await stored(w, keys.contribution(REPO, 12))).toMatchObject({
      messageId: 8,
      topic: null,
    });
    // Its next message stays there, without a new topic.
    await show(w.context, (await w.context.store.get(item.id)) as Item, true);
    expect(w.net.telegram("createForumTopic")).toHaveLength(1);
    expect(sent(w).at(-1)).not.toHaveProperty("message_thread_id");
    warn.mockRestore();
  });

  it("keeps the old name when Telegram refuses a rename, and tries again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const w = await chat();
    await apply(w.context, failing("check:lint"));
    let refuse = true;
    w.net.on("POST", /\/editForumTopic$/, () =>
      refuse
        ? refused("Bad Request: TOPIC_ID_INVALID")()
        : json({ ok: true, result: true }),
    );
    await apply(w.context, { ...at, type: "recovered", key: "check:lint" });
    const item = (await stored(w, keys.alarm(REPO))) as Item;
    expect(item.topic?.name).toBe("🚨 demo needs you");
    expect(warn).toHaveBeenCalledWith(
      "Telegram editForumTopic: Bad Request: TOPIC_ID_INVALID",
    );
    refuse = false;
    await show(w.context, item);
    expect((await stored(w, keys.alarm(REPO)))?.topic?.name).toBe(
      "✅ 🚨 demo needs you",
    );
    expect(w.net.telegram("editForumTopic")).toHaveLength(2);
    warn.mockRestore();
  });

  it("opens no topic for a thing from before topics", async () => {
    const w = await chat();
    // A record from before topics has no topic at all.
    const old = issue();
    expect(old).not.toHaveProperty("topic");
    await w.context.store.put(old);
    await show(w.context, old, true);
    expect(w.net.telegram("createForumTopic")).toHaveLength(0);
    expect(sent(w)[0]).not.toHaveProperty("message_thread_id");
    expect((await w.context.store.get(ID))?.topic).toBeNull();
  });
});

describe("a text in a topic", () => {
  async function control(w: World, value: object): Promise<number> {
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
    return response.status;
  }

  const payloads = (w: World) =>
    w.net.github("/dispatches").map((call) => call.body.client_payload);

  it("goes to the control repository with the thing, and its answer into the topic", async () => {
    const w = await chat();
    await apply(w.context, failing("check:lint"));
    expect(
      await handleUpdate(
        w.context,
        text("Why?", { message_thread_id: 900, is_topic_message: true }),
      ),
    ).toBe("free text sent");
    expect(payloads(w)).toEqual([
      {
        text: "Why?",
        message: 500,
        item: {
          id: await itemId(keys.alarm(REPO)),
          kind: "alarm",
          repo: REPO,
          state: "open",
          links: [
            `https://github.com/${REPO}/actions`,
            `https://github.com/${REPO}/actions/runs/1`,
          ],
          text: "🚨 Dennis-Otto/demo needs you\n• A bot fails: check:lint fails",
        },
        language: "en",
      },
    ]);
    expect(
      await control(w, { type: "note", text: "Lint broke.", message: 500 }),
    ).toBe(200);
    expect(sent(w).at(-1)).toMatchObject({
      message_thread_id: 900,
      text: "🤖 Lint broke.",
    });
  });

  it("starts a conversation of its own in a topic of the maintainer, in General, and for a thing that is gone", async () => {
    const w = await chat();
    await apply(w.context, failing("check:lint"));
    await env.PAGER.delete(`item:${await itemId(keys.alarm(REPO))}`);
    await handleUpdate(w.context, text("Ideas?", { message_thread_id: 950 }));
    await handleUpdate(w.context, text("Hi", { message_id: 501 }));
    await handleUpdate(
      w.context,
      text("Still red?", { message_id: 502, message_thread_id: 900 }),
    );
    expect(payloads(w).map((payload) => "item" in payload)).toEqual([
      false,
      false,
      false,
    ]);
    expect(await w.context.store.thread(500)).toBe(950);
    expect(await w.context.store.thread(501)).toBeNull();
  });

  it("passes over the service message of a topic that the maintainer opens, and answers in it", async () => {
    const w = await world();
    const opened = {
      message: {
        message_id: 600,
        chat: { id: CHAT },
        from: { id: CHAT },
        message_thread_id: 950,
        is_topic_message: true,
        forum_topic_created: { name: "Ideas", icon_color: 0x6fb9f0 },
      },
    };
    expect(await handleUpdate(w.context, opened)).toBe(
      "a topic of the maintainer",
    );
    expect(w.net.calls).toEqual([]);
    expect(
      await handleUpdate(w.context, text("/help", { message_thread_id: 950 })),
    ).toBe("help");
    expect(sent(w)[0]?.message_thread_id).toBe(950);
  });

  it("answers the first text of a topic opened on a phone, which comes without its thread, in the main view", async () => {
    // Telegram's bug tracker: the first message in a topic that a user opens on a
    // phone can come without its message_thread_id.
    const w = await chat();
    expect(
      await handleUpdate(
        w.context,
        text("First words", { is_topic_message: true }),
      ),
    ).toBe("free text sent");
    expect("item" in (payloads(w)[0] ?? {})).toBe(false);
    expect(await w.context.store.thread(500)).toBeNull();
    expect(
      await control(w, { type: "note", text: "Hello.", message: 500 }),
    ).toBe(200);
    expect(sent(w).at(-1)).not.toHaveProperty("message_thread_id");
  });
});

describe("what a text in a topic tells about its thing", () => {
  const t = texts("en");

  it("names a release with its number, its version and its link", () => {
    expect(about(release, START, t)).toEqual({
      id: ID,
      kind: "release",
      repo: REPO,
      state: "ready",
      number: 30,
      version: "1.2.3",
      links: [PULL_URL],
      text: '📦 Release 1.2.3 of Dennis-Otto/demo: #30\nEvery check is green, and "Merge" publishes it.',
    });
  });

  it("gives the message as plain text, and links of GitHub only", () => {
    const told = about(
      issue({
        title: `<b>"Crash" & burn</b>`,
        url: "https://example.com/12",
        note: "Looked at it.",
      }),
      START,
      t,
    );
    expect(told).toMatchObject({ kind: "contribution", number: 12, links: [] });
    expect(told).not.toHaveProperty("version");
    expect(told.text).toBe(
      `🙋 New issue in Dennis-Otto/demo by octocat\n#12 <b>"Crash" & burn</b>\nLooked at it.`,
    );
  });

  it("lists a page and twenty entries of a bundle at most, and cuts a long message", () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({
      key: `alert:${index}`,
      label: `alert ${index}`,
      url: `https://github.com/${REPO}/security/code-scanning/${index}`,
    }));
    const told = about({ ...alert, entries }, START, t);
    expect(told.links).toHaveLength(MAX_LINKS);
    expect(told.links[0]).toBe(
      `https://github.com/${REPO}/security/code-scanning`,
    );
    const long = about(
      issue({ state: "draft", draft: "x".repeat(3000), draftVersion: 1 }),
      START,
      t,
    );
    expect(long.text).toHaveLength(MAX_ABOUT);
    expect(long.text.endsWith("…")).toBe(true);
    expect(about(reminder, START, t)).toMatchObject({
      kind: "reminder",
      links: [],
      text: "🔔 Renew the token.",
    });
  });
});

describe("Telegram's topics", () => {
  const telegram = (net: Net) => new Telegram("123:test", CHAT, net.fetch);

  it("asks getMe once whether the chat has topics, and takes a refusal as none", async () => {
    const net = withTopics(new Net());
    const api = telegram(net);
    expect(await api.topics()).toBe(true);
    expect(await api.topics()).toBe(true);
    expect(net.telegram("getMe")).toHaveLength(1);
    expect(await telegram(new Net()).topics()).toBe(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unknown = new Net().on("POST", /\/getMe$/, () =>
      json({ ok: false, description: "Unauthorized" }, 401),
    );
    expect(await telegram(unknown).topics()).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "Telegram getMe: Unauthorized; no topics",
    );
    warn.mockRestore();
    const broken = new Net().on("POST", /\/getMe$/, () => {
      throw new TypeError("network");
    });
    await expect(telegram(broken).topics()).rejects.toThrow("network");
  });

  it("opens a topic only in a chat with topics, and takes an answer without its thread as none", async () => {
    const none = new Net();
    expect(await telegram(none).openTopic("x", TOPIC_COLORS.red)).toBeNull();
    expect(none.telegram("createForumTopic")).toHaveLength(0);
    const odd = withTopics(new Net()).on("POST", /\/createForumTopic$/, () =>
      json({ ok: true, result: null }),
    );
    expect(await telegram(odd).openTopic("x", TOPIC_COLORS.red)).toBeNull();
    const broken = withTopics(new Net()).on(
      "POST",
      /\/createForumTopic$/,
      () => {
        throw new TypeError("network");
      },
    );
    await expect(
      telegram(broken).openTopic("x", TOPIC_COLORS.red),
    ).rejects.toThrow("network");
  });

  it("renames a topic, takes the same name as done, and passes on a broken network", async () => {
    const net = new Net();
    expect(await telegram(net).renameTopic(900, "✅ x")).toBe(true);
    const same = new Net().on(
      "POST",
      /\/editForumTopic$/,
      refused("Bad Request: TOPIC_NOT_MODIFIED"),
    );
    expect(await telegram(same).renameTopic(900, "x")).toBe(true);
    const broken = new Net().on("POST", /\/editForumTopic$/, () => {
      throw new TypeError("network");
    });
    await expect(telegram(broken).renameTopic(900, "x")).rejects.toThrow(
      "network",
    );
  });

  it("deletes a topic, and passes over one that is gone, but not a broken network", async () => {
    const gone = new Net().on(
      "POST",
      /\/deleteForumTopic$/,
      refused("Bad Request: TOPIC_ID_INVALID"),
    );
    await telegram(gone).removeTopic(900);
    expect(gone.telegram("deleteForumTopic")).toHaveLength(1);
    const broken = new Net().on("POST", /\/deleteForumTopic$/, () => {
      throw new TypeError("network");
    });
    await expect(telegram(broken).removeTopic(900)).rejects.toThrow("network");
  });

  it("answers a message in the main view, also when its thread is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const net = new Net();
    expect(await telegram(net).post("Hi", [], null, 7)).toEqual({
      message: 100,
      thread: null,
    });
    expect(await telegram(net).post("Hi", [], 900, 7)).toEqual({
      message: 101,
      thread: 900,
    });
    let tries = 0;
    const gone = new Net().on("POST", /\/sendMessage$/, () =>
      tries++ === 0
        ? refused("Bad Request: message thread not found")()
        : json({ ok: true, result: { message_id: 8 } }),
    );
    expect(await telegram(gone).post("Hi", [], 900, 7)).toEqual({
      message: 8,
      thread: null,
    });
    const reply = { message_id: 7, allow_sending_without_reply: true };
    const [main, topic] = net.telegram("sendMessage").map((c) => c.body);
    expect(main?.reply_parameters).toEqual(reply);
    expect(topic).not.toHaveProperty("reply_parameters");
    const [first, second] = gone.telegram("sendMessage").map((c) => c.body);
    expect(first).not.toHaveProperty("reply_parameters");
    expect(second).toMatchObject({ reply_parameters: reply });
    expect(second).not.toHaveProperty("message_thread_id");
    warn.mockRestore();
  });
});
