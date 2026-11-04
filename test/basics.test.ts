// The small parts: the cryptography, the settings, the allowlist of the buttons and
// the escaping of every text that a message shows.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  allowed,
  callbackData,
  keyboard,
  LABELS,
  parsePress,
} from "../src/buttons.ts";
import {
  base64url,
  fromHex,
  hmacHex,
  safeEqual,
  sha256Hex,
  toHex,
  verifySignature,
} from "../src/crypto.ts";
import { html, link, render } from "../src/render.ts";
import { type PagerEnv, readSettings } from "../src/settings.ts";
import type { Contribution, Item } from "../src/store.ts";
import { base, START } from "./helpers.ts";

const ID = "i0123456789abcde";

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
      },
    });
    const all = readSettings({
      ...complete,
      CONTROL_SECRET: " control ",
      GITHUB_USER_TOKEN: "user",
      CLAUDE_TOKEN_EXPIRES: "",
    } as unknown as PagerEnv);
    expect(all).toMatchObject({
      settings: {
        controlSecret: "control",
        userToken: "user",
        tokenExpires: null,
      },
    });
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
      } as unknown as PagerEnv),
    ).toEqual({
      missing: [
        "TELEGRAM_CHAT_ID (a number)",
        "LATER_HOURS (hours, from 1 to 336)",
        "CLAUDE_TOKEN_EXPIRES (a date such as 2027-10-07)",
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
    expect(keyboard(item)).toEqual([
      [
        { text: LABELS.send, callback_data: `send:${ID}:3` },
        { text: LABELS.edit, callback_data: `edit:${ID}` },
      ],
      [
        { text: LABELS.later, callback_data: `later:${ID}` },
        { text: LABELS.ignore, callback_data: `ignore:${ID}` },
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
      for (const row of keyboard(item)) {
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
    const text = render(item, START);
    expect(text).toContain("🙋 <b>New issue</b>");
    expect(text).toContain("#12 &lt;b&gt;bold&lt;/b&gt;");
    expect(text).toContain("<blockquote>Thanks &lt;3</blockquote>");
    expect(render({ ...item, state: "sent" }, START)).not.toContain(
      "blockquote",
    );
    expect(render({ ...item, state: "ignored" }, START)).toContain(
      "✖ Ignored.",
    );
    expect(render(contribution({ pull: true }), START)).toContain(
      "New pull request",
    );
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
    expect(render(alarm, START)).toBe(
      [
        "🚨 <b>Dennis-Otto/demo needs you</b>",
        '• <a href="https://github.com/x">lint fails</a>',
        "🛠 A fix is under way in the control repository…",
        "<i>PR #3 fixes it</i>",
        "⏰ Back in 2 h.",
      ].join("\n"),
    );
    expect(render({ ...alarm, snoozedUntil: START + 60000 }, START)).toContain(
      "Back in 1 h.",
    );
    expect(render({ ...alarm, snoozedUntil: START - 1 }, START)).not.toContain(
      "Back in",
    );
    expect(
      render({ ...base(ID), kind: "alert", state: "open", entries: [] }, START),
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
    expect(render(release, START)).toContain('"Merge" publishes it.');
    expect(render({ ...release, state: "published" }, START)).toContain(
      "✅ Published.",
    );
    expect(render({ ...release, state: "merging" }, START)).toContain(
      "🔀 Merging…",
    );
    expect(
      render(
        { ...base(ID), kind: "reminder", state: "open", text: "Renew <it>" },
        START,
      ),
    ).toBe("🔔 Renew &lt;it&gt;");
  });
});
