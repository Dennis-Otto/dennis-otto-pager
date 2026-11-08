// The small parts: the cryptography, the settings, the allowlist of the buttons and
// the escaping of every text that a message shows.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  allowed,
  callbackData,
  keyboard,
  label,
  parsePress,
} from "../src/buttons.ts";
import { MAX_EXCERPT } from "../src/content.ts";
import {
  base64url,
  fromHex,
  hmacHex,
  safeEqual,
  sha256Hex,
  toHex,
  verifySignature,
} from "../src/crypto.ts";
import {
  html,
  link,
  MAX_ENTRIES,
  MAX_MESSAGE,
  render,
  visible,
} from "../src/render.ts";
import { type PagerEnv, readSettings } from "../src/settings.ts";
import type { Contribution, Item } from "../src/store.ts";
import { texts } from "../src/texts.ts";
import { MAX_DRAFT } from "../src/updates.ts";
import { base, START } from "./helpers.ts";

const ID = "i0123456789abcde";
const en = texts("en");

function contribution(extra: Partial<Contribution> = {}): Contribution {
  return {
    ...base(ID),
    kind: "contribution",
    state: "new",
    number: 12,
    pull: false,
    title: "Title",
    url: "https://github.com/Dennis-Otto/demo/issues/12",
    author: "octocat",
    draft: null,
    draftVersion: 0,
    ...extra,
  };
}

describe("cryptography", () => {
  it("compares texts of each length", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("secret", "secrets")).toBe(false);
  });

  it("reads hexadecimal digits and refuses anything else", () => {
    expect(fromHex("00ff10")).toEqual(new Uint8Array([0, 255, 16]));
    expect(fromHex("abc")).toBeNull();
    expect(fromHex("zz")).toBeNull();
    fc.assert(
      fc.property(fc.uint8Array(), (bytes) => {
        expect(fromHex(toHex(bytes))).toEqual(bytes);
      }),
    );
  });

  it("verifies the signature of GitHub, as its documentation shows it", async () => {
    // The example of "Validating webhook deliveries" in the docs of GitHub.
    const signature =
      "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";
    expect(
      await verifySignature(
        "It's a Secret to Everybody",
        "Hello, World!",
        signature,
      ),
    ).toBe(true);
    expect(await hmacHex("It's a Secret to Everybody", "Hello, World!")).toBe(
      signature.slice(7),
    );
    expect(
      await verifySignature("another secret", "Hello, World!", signature),
    ).toBe(false);
    expect(
      await verifySignature("It's a Secret to Everybody", "Hello!", signature),
    ).toBe(false);
    expect(await verifySignature("s", "x", null)).toBe(false);
    expect(await verifySignature("s", "x", "sha1=00")).toBe(false);
    expect(await verifySignature("s", "x", "sha256=00ff")).toBe(false);
  });

  it("hashes and encodes as a JWT needs it", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(base64url("ab?>")).toBe("YWI_Pg");
    expect(base64url(new Uint8Array([251, 255]))).toBe("-_8");
    expect(base64url(new Uint8Array([1]).buffer)).toBe("AQ");
  });
});

describe("settings", () => {
  const complete = {
    TELEGRAM_BOT_TOKEN: "123:test",
    TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    TELEGRAM_CHAT_ID: "4242",
    GITHUB_WEBHOOK_SECRET: "github-secret",
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: "key",
    MAINTAINER_LOGIN: "Dennis-Otto",
    CONTROL_REPOSITORY: "Dennis-Otto/control",
    LATER_HOURS: "4",
    CLAUDE_TOKEN_EXPIRES: "2027-10-07",
  } as unknown as PagerEnv;

  it("reads every setting, the optional ones as null", () => {
    expect(readSettings(complete)).toEqual({
      settings: {
        telegramToken: "123:test",
        telegramSecret: "telegram-secret",
        chatId: 4242,
        githubSecret: "github-secret",
        appId: "12345",
        appKey: "key",
        controlSecret: null,
        userToken: null,
        maintainer: "Dennis-Otto",
        controlRepository: "Dennis-Otto/control",
        laterHours: 4,
        tokenExpires: "2027-10-07",
        language: "en",
      },
    });
    const all = readSettings({
      ...complete,
      CONTROL_SECRET: " control ",
      GITHUB_USER_TOKEN: "user",
      CLAUDE_TOKEN_EXPIRES: "",
      LANGUAGE: " de ",
    } as unknown as PagerEnv);
    expect(all).toMatchObject({
      settings: {
        controlSecret: "control",
        userToken: "user",
        tokenExpires: null,
        language: "de",
      },
    });
    expect(
      readSettings({ ...complete, LANGUAGE: "" } as unknown as PagerEnv),
    ).toMatchObject({ settings: { language: "en" } });
  });

  it("names what is missing or wrong, never a value", () => {
    expect(
      readSettings({
        ...complete,
        TELEGRAM_BOT_TOKEN: " ",
      } as unknown as PagerEnv),
    ).toEqual({
      missing: ["TELEGRAM_BOT_TOKEN"],
    });
    expect(
      readSettings({
        ...complete,
        TELEGRAM_CHAT_ID: "me",
        LATER_HOURS: "0",
        CLAUDE_TOKEN_EXPIRES: "soon",
        LANGUAGE: "fr",
      } as unknown as PagerEnv),
    ).toEqual({
      missing: [
        "TELEGRAM_CHAT_ID (a number)",
        "LATER_HOURS (hours, from 1 to 336)",
        "CLAUDE_TOKEN_EXPIRES (a date such as 2027-10-07)",
        "LANGUAGE (en or de)",
      ],
    });
  });
});

describe("the buttons", () => {
  it("offer per state only what fits it", () => {
    const states: [Item, string[]][] = [
      [contribution(), ["draft", "assistant", "later", "ignore"]],
      [contribution({ pull: true }), ["draft", "later", "ignore"]],
      [contribution({ state: "drafting" }), ["later", "ignore"]],
      [contribution({ state: "draft" }), ["send", "edit", "later", "ignore"]],
      [contribution({ state: "sent" }), []],
      // A discussion gets its draft by itself: send, edit or ignore it.
      [contribution({ discussion: { node: "D_1" } }), ["draft", "ignore"]],
      [
        contribution({ state: "drafting", discussion: { node: "D_1" } }),
        ["ignore"],
      ],
      [
        contribution({ state: "draft", discussion: { node: "D_1" } }),
        ["send", "edit", "ignore"],
      ],
      [contribution({ state: "sent", discussion: { node: "D_1" } }), []],
      [
        { ...base(ID), kind: "alarm", state: "open", entries: [] },
        ["fix", "later", "ignore"],
      ],
      [
        { ...base(ID), kind: "alert", state: "fixing", entries: [] },
        ["later", "ignore"],
      ],
      [{ ...base(ID), kind: "alarm", state: "recovered", entries: [] }, []],
      [
        {
          ...base(ID),
          kind: "release",
          state: "ready",
          number: 1,
          version: "1.0.0",
          sha: "a",
          url: "",
        },
        ["merge", "later", "ignore"],
      ],
      [
        {
          ...base(ID),
          kind: "release",
          state: "merged",
          number: 1,
          version: "1.0.0",
          sha: "a",
          url: "",
        },
        [],
      ],
      [
        { ...base(ID), kind: "reminder", state: "open", text: "" },
        ["done", "later"],
      ],
      [{ ...base(ID), kind: "reminder", state: "done", text: "" }, []],
    ];
    for (const [item, actions] of states) {
      expect(allowed(item)).toEqual(actions);
    }
  });

  it("carry the version of the draft that the message shows", () => {
    const item = contribution({ state: "draft", draftVersion: 3 });
    expect(callbackData("send", item)).toBe(`send:${ID}:3`);
    expect(callbackData("edit", item)).toBe(`edit:${ID}`);
    expect(keyboard(item, en)).toEqual([
      [
        { text: label(en, "send"), callback_data: `send:${ID}:3` },
        { text: label(en, "edit"), callback_data: `edit:${ID}` },
      ],
      [
        { text: label(en, "later"), callback_data: `later:${ID}` },
        { text: label(en, "ignore"), callback_data: `ignore:${ID}` },
      ],
    ]);
  });

  it("read back the data that they wrote, and nothing else", () => {
    expect(parsePress(`send:${ID}:3`)).toEqual({
      action: "send",
      id: ID,
      version: 3,
    });
    expect(parsePress(`later:${ID}`)).toEqual({
      action: "later",
      id: ID,
      version: null,
    });
    expect(parsePress(`delete:${ID}`)).toBeNull();
    expect(parsePress("later:other")).toBeNull();
    fc.assert(
      fc.property(fc.string(), (data) => {
        const press = parsePress(data);
        return press === null || data.startsWith(`${press.action}:`);
      }),
    );
    for (const item of [contribution({ state: "draft", draftVersion: 99 })]) {
      for (const row of keyboard(item, en)) {
        for (const button of row) {
          expect(
            new TextEncoder().encode(button.callback_data).length,
          ).toBeLessThanOrEqual(64);
          expect(parsePress(button.callback_data)).not.toBeNull();
        }
      }
    }
  });
});

describe("the text of a message", () => {
  it("escapes every text and cuts long ones", () => {
    expect(html(`<a href="x">&</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;",
    );
    expect(html("abcdef", 4)).toBe("abc…");
    fc.assert(fc.property(fc.string(), (text) => !/[<>"]/.test(html(text))));
  });

  it("links only to GitHub", () => {
    expect(link("x", "https://github.com/a")).toBe(
      '<a href="https://github.com/a">x</a>',
    );
    expect(link("<x>", "https://evil.example/")).toBe("&lt;x&gt;");
    expect(link("x", 'https://github.com/"onclick')).toBe(
      '<a href="https://github.com/&quot;onclick">x</a>',
    );
  });

  it("shows a contribution with its draft, and without it once it is done", () => {
    const item = contribution({
      state: "draft",
      draft: "Thanks <3",
      title: "<b>bold</b>",
    });
    const text = render(item, START, en);
    expect(text).toContain("🙋 <b>New issue</b>");
    expect(text).toContain("#12 &lt;b&gt;bold&lt;/b&gt;");
    expect(text).toContain("<blockquote>Thanks &lt;3</blockquote>");
    expect(render({ ...item, state: "sent" }, START, en)).not.toContain(
      "blockquote",
    );
    expect(render({ ...item, state: "ignored" }, START, en)).toContain(
      "✖ Ignored.",
    );
    expect(render(contribution({ pull: true }), START, en)).toContain(
      "New pull request",
    );
  });

  it("shows a discussion and a comment on one, whose reply goes as the app", () => {
    const discussion = contribution({
      number: 31,
      title: "How?",
      url: "https://github.com/Dennis-Otto/demo/discussions/31",
      discussion: { node: "D_1" },
    });
    expect(render(discussion, START, en)).toContain(
      '💬 <b>New discussion</b> in <a href="https://github.com/Dennis-Otto/demo">Dennis-Otto/demo</a> by <b>octocat</b>\n<a href="https://github.com/Dennis-Otto/demo/discussions/31">#31 How?</a>',
    );
    const drafted = render(
      {
        ...discussion,
        state: "draft",
        draft: "Read the README.",
        discussion: { node: "D_1", comment: "DC_7" },
      },
      START,
      en,
    );
    expect(drafted).toContain("💬 <b>New comment</b> on a discussion in");
    expect(drafted).toContain(
      '"Send" posts in the discussion as the app of the pager, as it stands here:\n<blockquote>Read the README.</blockquote>',
    );
  });

  it("quotes the start of what a contribution says, escaped and folded", () => {
    const said = contribution({
      excerpt:
        '</blockquote><a href="https://evil.example/">x</a> <b>&amp;</b> <tg-spoiler>',
    });
    const text = render(said, START, en);
    expect(text).toContain(
      '<a href="https://github.com/Dennis-Otto/demo/issues/12">#12 Title</a>\n<blockquote expandable>&lt;/blockquote&gt;&lt;a href=&quot;https://evil.example/&quot;&gt;x&lt;/a&gt; &lt;b&gt;&amp;amp;&lt;/b&gt; &lt;tg-spoiler&gt;</blockquote>',
    );
    expect(text.match(/<blockquote/g)).toHaveLength(1);
    // The quote comes before the draft, which stays whole.
    const drafted = render(
      { ...said, excerpt: "It breaks", state: "draft", draft: "Thanks" },
      START,
      en,
    );
    expect(drafted).toMatch(
      /<blockquote expandable>It breaks<\/blockquote>\n\n<b>Draft of a reply<\/b>.*\n<blockquote>Thanks<\/blockquote>$/,
    );
    // A closed thing still says what it was about.
    expect(render({ ...said, state: "sent" }, START, en)).toContain(
      "<blockquote expandable>",
    );
    expect(render(contribution(), START, en)).not.toContain("blockquote");
  });

  it("counts the characters as Telegram does, without tags and with an entity as one", () => {
    expect(
      visible('<a href="https://github.com/">a &amp; b</a> &lt;&gt;&quot;'),
    ).toBe(9);
    // A sign of & alone counts as itself, and a text of many < at once.
    expect(visible("a & b &amp")).toBe(10);
    const begin = Date.now();
    expect(visible("<".repeat(200_000))).toBe(0);
    expect(visible("&".repeat(200_000))).toBe(200_000);
    expect(Date.now() - begin).toBeLessThan(1000);
    fc.assert(
      fc.property(
        fc.string(),
        (text) => visible(html(text, 10_000)) === text.length,
      ),
    );
  });

  it("keeps every contribution within the limit of Telegram, its draft whole", () => {
    const longest = contribution({
      repo: `${"o".repeat(39)}/${"r".repeat(100)}`,
      author: "a".repeat(39),
      title: "t".repeat(1000),
      number: 99999,
      comment: { id: 1, noticed: START },
      pull: true,
      excerpt: "e".repeat(MAX_EXCERPT),
      state: "draft",
      draft: "d".repeat(MAX_DRAFT),
      note: "n".repeat(1000),
      snoozedUntil: START + 3600000,
    });
    for (const language of ["en", "de"] as const) {
      const text = render(longest, START, texts(language));
      expect(visible(text)).toBeLessThanOrEqual(MAX_MESSAGE);
      expect(text).toContain("d".repeat(MAX_DRAFT));
    }
    // With room, the quote and the note show whole.
    const roomy = render(
      { ...longest, draft: "Thanks", note: "n".repeat(500) },
      START,
      en,
    );
    expect(roomy).toContain(
      `<blockquote expandable>${"e".repeat(MAX_EXCERPT)}</blockquote>`,
    );
    expect(roomy).toContain(`<i>${"n".repeat(500)}</i>`);
    // With less room, the quote gets shorter, and with too little it goes.
    const tight = render({ ...longest, note: null }, START, en);
    expect(visible(tight)).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(tight).toMatch(/<blockquote expandable>e+…<\/blockquote>/);
    const full = render(
      { ...longest, note: "n".repeat(500), title: "t".repeat(1000) },
      START,
      en,
    );
    expect(full).not.toContain("<blockquote expandable>");
    expect(visible(full)).toBeLessThanOrEqual(MAX_MESSAGE);
  });

  it("shows the notes of a release, with its breaking changes and the rest linked", () => {
    const release: Item = {
      ...base(ID),
      kind: "release",
      state: "ready",
      number: 30,
      version: "2.0.0",
      sha: "abc",
      url: "https://github.com/Dennis-Otto/demo/pull/30",
      notes: {
        lines: [
          { heading: "⚠ BREAKING CHANGES" },
          { item: "the old <flag> is gone #56, see (#57) and x#58" },
          { heading: "Features" },
          { item: "new &#12; things" },
          { text: "A paragraph, #59" },
        ],
        more: 3,
        breaking: true,
      },
    };
    expect(render(release, START, en)).toBe(
      [
        '📦 <b>Release 2.0.0</b> of <a href="https://github.com/Dennis-Otto/demo">Dennis-Otto/demo</a>: <a href="https://github.com/Dennis-Otto/demo/pull/30">#30</a>',
        "⚠️ <b>Breaking changes</b>: read the notes before you merge.",
        "",
        "<b>⚠ BREAKING CHANGES</b>",
        '• the old &lt;flag&gt; is gone <a href="https://github.com/Dennis-Otto/demo/issues/56">#56</a>, see (<a href="https://github.com/Dennis-Otto/demo/issues/57">#57</a>) and x#58',
        "<b>Features</b>",
        "• new &amp;#12; things",
        'A paragraph, <a href="https://github.com/Dennis-Otto/demo/issues/59">#59</a>',
        '<a href="https://github.com/Dennis-Otto/demo/pull/30">… and 3 more</a>',
        "",
        'Every check is green, and "Merge" publishes it.',
      ].join("\n"),
    );
    expect(render({ ...release, state: "merging" }, START, en)).toMatch(
      /… and 3 more<\/a>\n🔀 Merging…$/,
    );
    // Notes without a line, and none at all, show the release as before.
    const bare = render(
      { ...release, notes: { lines: [], more: 0, breaking: false } },
      START,
      en,
    );
    expect(bare).toMatch(/#30<\/a>\nEvery check is green/);
    const { notes: _notes, ...without } = release;
    expect(render(without as Item, START, en)).toBe(bare);
    expect(
      render(
        { ...release, notes: { lines: [], more: 2, breaking: false } },
        START,
        en,
      ),
    ).toMatch(/#30<\/a>\n\n<a href="[^"]+">… and 2 more<\/a>\n\nEvery check/);
  });

  it("keeps a bundle of many entries below the limit of Telegram", () => {
    const many = (count: number, label: (n: number) => string): Item => ({
      ...base(ID),
      kind: "alert",
      state: "open",
      entries: Array.from({ length: count }, (_, n) => ({
        key: `alert:${n}`,
        label: label(n),
        url: `https://github.com/Dennis-Otto/demo/security/code-scanning/${n}`,
      })),
    });
    const hundred = render(
      many(100, (n) => `high: rule ${n}`),
      START,
      en,
    );
    const listed = hundred.split("\n").filter((line) => line.startsWith("•"));
    expect(listed).toHaveLength(MAX_ENTRIES);
    expect(hundred).toContain(
      '<a href="https://github.com/Dennis-Otto/demo/security/code-scanning">… and 80 more</a>',
    );
    const long = render(
      many(100, (n) => `${n} ${"x".repeat(400)}`),
      START,
      en,
    );
    expect(long.length).toBeLessThan(4096);
    expect(long).toMatch(/… and \d+ more<\/a>$/);
    const alarm = render(
      { ...many(21, (n) => `check ${n}`), kind: "alarm" } as Item,
      START,
      en,
    );
    expect(alarm).toContain(
      '<a href="https://github.com/Dennis-Otto/demo/actions">… and 1 more</a>',
    );
    expect(
      render(
        many(MAX_ENTRIES, (n) => `${n}`),
        START,
        en,
      ),
    ).not.toContain("more");
  });

  it("shows bundles, releases and reminders with their state, note and Later", () => {
    const alarm: Item = {
      ...base(ID),
      kind: "alarm",
      state: "fixing",
      note: "PR #3 fixes it",
      snoozedUntil: START + 2 * 3600000,
      entries: [{ key: "a", label: "lint fails", url: "https://github.com/x" }],
    };
    expect(render(alarm, START, en)).toBe(
      [
        "🚨 <b>Dennis-Otto/demo needs you</b>",
        '• <a href="https://github.com/x">lint fails</a>',
        "🛠 A fix is under way in the control repository…",
        "<i>PR #3 fixes it</i>",
        "⏰ Back in 2 h.",
      ].join("\n"),
    );
    expect(
      render({ ...alarm, snoozedUntil: START + 60000 }, START, en),
    ).toContain("Back in 1 h.");
    expect(
      render({ ...alarm, snoozedUntil: START - 1 }, START, en),
    ).not.toContain("Back in");
    expect(
      render(
        { ...base(ID), kind: "alert", state: "open", entries: [] },
        START,
        en,
      ),
    ).toBe("🛡 <b>Code scanning in Dennis-Otto/demo</b>\n");
    const release: Item = {
      ...base(ID),
      kind: "release",
      state: "ready",
      number: 30,
      version: "1.2.3",
      sha: "abc",
      url: "https://github.com/Dennis-Otto/demo/pull/30",
    };
    expect(render(release, START, en)).toContain('"Merge" publishes it.');
    expect(render({ ...release, state: "published" }, START, en)).toContain(
      "✅ Published.",
    );
    expect(render({ ...release, state: "merging" }, START, en)).toContain(
      "🔀 Merging…",
    );
    expect(
      render(
        { ...base(ID), kind: "reminder", state: "open", text: "Renew <it>" },
        START,
        en,
      ),
    ).toBe("🔔 Renew &lt;it&gt;");
  });
});
