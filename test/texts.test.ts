// The texts of the pager: both catalogs say the same with the same parts, the
// placeholders take what GitHub says as it is, and with LANGUAGE "de" every text
// that the maintainer gets is German, while what comes from GitHub stays as it is.
import { describe, expect, it } from "vitest";

import { handleControl } from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import { apply, show } from "../src/pager.ts";
import { runSchedule } from "../src/schedule.ts";
import { type Contribution, itemId, keys, type Release } from "../src/store.ts";
import {
  CATALOGS,
  type Key,
  LANGUAGES,
  languageOf,
  texts,
} from "../src/texts.ts";
import { handleUpdate } from "../src/updates.ts";
import {
  base,
  CHAT,
  json,
  REPO,
  START,
  type World,
  withControl,
  world,
} from "./helpers.ts";

const KEYS = Object.keys(CATALOGS.en).sort() as Key[];

/** The parts of a text that every language keeps, each sorted. */
function parts(text: string) {
  return {
    placeholders: [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
    tags: [...text.matchAll(/<\/?[a-z]+>/g)].map((m) => m[0]),
    emojis: [...text.matchAll(/\p{Extended_Pictographic}/gu)]
      .map((m) => m[0])
      .sort(),
  };
}

describe("the catalogs", () => {
  it("have the same keys in every language", () => {
    for (const language of LANGUAGES) {
      expect(Object.keys(CATALOGS[language]).sort()).toEqual(KEYS);
    }
  });

  it("keep the placeholders, the tags and the emojis of each text", () => {
    for (const language of LANGUAGES) {
      for (const key of KEYS) {
        const text = CATALOGS[language][key];
        expect(text.trim(), `${language} ${key}`).not.toBe("");
        expect(parts(text), `${language} ${key}`).toEqual(
          parts(CATALOGS.en[key]),
        );
      }
    }
  });

  it("hold only the HTML that Telegram reads", () => {
    for (const language of LANGUAGES) {
      for (const key of KEYS) {
        const bare = CATALOGS[language][key]
          .replace(/<\/?(b|i|blockquote)>/g, "")
          .replace(/\{\w+\}/g, "");
        expect(bare, `${language} ${key}`).not.toMatch(/[<>&]/);
      }
    }
  });
});

describe("the texts", () => {
  it("fill each placeholder once, with what GitHub says as it is", () => {
    const t = texts("en");
    expect(t("entry.bot", { title: "{title} costs $& and $1" })).toBe(
      "A bot fails: {title} costs $& and $1",
    );
    expect(t("message.back", { hours: 3 })).toBe("⏰ Back in 3 h.");
    expect(t.phrase({ key: "blocker.draft" })).toBe("it is a draft");
    expect(t.phrase({ key: "blocker.base", values: { branch: "main" } })).toBe(
      "it doesn't go into main",
    );
    expect(t.language).toBe("en");
  });

  it("write a day as each language does", () => {
    expect(texts("en").date("2027-10-07")).toBe("2027-10-07");
    expect(texts("de").date("2027-10-07")).toBe("07.10.2027");
  });

  it("take the language of LANGUAGE, English when it is empty", () => {
    expect(languageOf(undefined)).toBe("en");
    expect(languageOf(" ")).toBe("en");
    expect(languageOf(" de ")).toBe("de");
    expect(languageOf("en")).toBe("en");
    expect(languageOf("fr")).toBeNull();
  });
});

const ID = "i0123456789abcde";

function issue(extra: Partial<Contribution> = {}): Contribution {
  return {
    ...base(ID),
    kind: "contribution",
    state: "new",
    number: 12,
    pull: false,
    title: "It breaks",
    url: `https://github.com/${REPO}/issues/12`,
    author: "octocat",
    draft: null,
    draftVersion: 0,
    ...extra,
  };
}

async function german(): Promise<World> {
  return world({ language: "de" });
}

async function press(w: World, data: string) {
  await handleUpdate(w.context, {
    callback_query: { id: "q1", from: { id: CHAT }, data },
  });
  return w.net.telegram("answerCallbackQuery").at(-1)?.body.text;
}

async function control(w: World, value: unknown) {
  const body = JSON.stringify(value);
  const stamp = String(START / 1000);
  return handleControl(
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
}

describe("the pager in German", () => {
  it("answers /help in German", async () => {
    const w = await german();
    await handleUpdate(w.context, {
      message: {
        message_id: 1,
        chat: { id: CHAT },
        from: { id: CHAT },
        text: "/help",
      },
    });
    expect(w.net.telegram("sendMessage")[0]?.body.text).toBe(
      CATALOGS.de["chat.help"],
    );
  });

  it("shows a contribution and its buttons in German, its title as it is", async () => {
    const w = await german();
    await apply(w.context, {
      repo: REPO,
      installation: 9,
      type: "contribution",
      number: 12,
      pull: true,
      title: "Add a dark mode",
      url: `https://github.com/${REPO}/pull/12`,
      author: "octocat",
    });
    const sent = w.net.telegram("sendMessage")[0]?.body;
    expect(sent.text).toContain("🙋 <b>Neuer Pull Request</b> in ");
    expect(sent.text).toContain(" von <b>octocat</b>");
    expect(sent.text).toContain("#12 Add a dark mode");
    expect(
      sent.reply_markup.inline_keyboard
        .flat()
        .map((b: { text: string }) => b.text),
    ).toEqual(["✍️ Antwort entwerfen", "⏰ Später", "✖ Ignorieren"]);
  });

  it("answers the buttons in German and says so in the message", async () => {
    const w = await german();
    await w.context.store.put(issue());
    expect(await press(w, `later:${ID}`)).toBe("Zurück in 4 Std.");
    expect(w.net.telegram("editMessageText")[0]?.body.text).toContain(
      "⏰ Zurück in 4 Std.",
    );
    expect(await press(w, `send:${ID}:1`)).toBe("Der Knopf ist veraltet.");
    expect(await press(w, "nonsense")).toBe("Diesen Knopf kenne ich nicht.");
    await w.context.store.put(issue({ state: "draft", draft: "Danke!" }));
    expect(await press(w, `edit:${ID}`)).toBe(
      "Schreib den neuen Text als Antwort.",
    );
    const prompt = w.net.telegram("sendMessage").at(-1)?.body;
    expect(prompt.text).toContain(
      `Antwort an ${REPO}#12. Die Nachricht des Entwurfs`,
    );
    expect(prompt.reply_markup.input_field_placeholder).toBe("Antwort");
    await show(w.context, issue({ state: "draft", draft: "Danke!" }));
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      "<b>Entwurf einer Antwort</b>, den „Senden“ genau so in deinem Namen postet:\n<blockquote>Danke!</blockquote>",
    );
  });

  it("says in German why a release doesn't merge", async () => {
    const w = await german();
    const release: Release = {
      ...base(ID),
      kind: "release",
      state: "ready",
      number: 30,
      version: "1.2.3",
      sha: "abc",
      url: `https://github.com/${REPO}/pull/30`,
    };
    await w.context.store.put(release);
    w.net.on("GET", `/repos/${REPO}/pulls/30`, () =>
      json({
        state: "open",
        title: "chore: release 1.2.3",
        mergeable_state: "behind",
        head: { ref: "release-please--branches--main", sha: "abc" },
        base: { ref: "main", repo: { default_branch: "main" } },
      }),
    );
    expect(await press(w, `merge:${ID}`)).toBe(
      "Nicht gemergt: seine Checks sind nicht alle grün (behind).",
    );
  });

  it("words the entries of an alarm in German, and sends the language to the control repository", async () => {
    const w = await german();
    await apply(w.context, {
      repo: REPO,
      installation: 9,
      type: "failing",
      key: "issue:5",
      label: { key: "entry.bot", values: { title: "Renovate fails" } },
      url: `https://github.com/${REPO}/issues/5`,
    });
    const text = w.net.telegram("sendMessage")[0]?.body.text;
    expect(text).toContain(`🚨 <b>${REPO} braucht dich</b>`);
    expect(text).toContain("Ein Bot scheitert: Renovate fails");
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    const alarm = await itemId(keys.alarm(REPO));
    expect(await press(w, `fix:${alarm}`)).toBe(
      "Ans Steuer-Repository geschickt: Claude sucht einen Fix, von deinem Wochenlimit.",
    );
    expect(w.net.github("/dispatches")[0]?.body.client_payload).toMatchObject({
      entries: [{ label: "Ein Bot scheitert: Renovate fails" }],
      language: "de",
    });
  });

  it("shows the answers of the control repository with German buttons and usage", async () => {
    const w = await german();
    const id = await itemId(keys.contribution(REPO, 12));
    await w.context.store.put(issue({ id }));
    await control(w, {
      type: "proposal",
      text: "Ich entwerfe eine Antwort.",
      action: "draft",
      target: { kind: "contribution", repo: REPO, number: 12 },
      usage: { turns: 1, seconds: 5 },
    });
    const proposal = w.net.telegram("sendMessage")[0]?.body;
    expect(proposal.text).toContain("👉 ✍️ Antwort entwerfen: ");
    expect(proposal.text).toContain(
      "🧮 Claude: 1 Runde, 5 s, von deinem Wochenlimit",
    );
    expect(proposal.reply_markup.inline_keyboard[0][0].text).toBe(
      "✅ Bestätigen",
    );
    await control(w, {
      type: "proposal",
      text: "Mergen?",
      action: "merge",
      target: { kind: "release", repo: REPO },
      usage: { turns: 3, seconds: 9 },
    });
    const none = w.net.telegram("sendMessage")[1]?.body.text;
    expect(none).toContain(
      "<i>Kein Knopf: Für 🔀 Mergen zeigt der Pager in Dennis-Otto/demo nichts (Release).</i>",
    );
    expect(none).toContain("3 Runden");
  });

  it("reminds of the token of Claude in German, with the German date", async () => {
    const soon = await world({ language: "de", tokenExpires: "2026-11-25" });
    await runSchedule(soon.context);
    expect(soon.net.telegram("sendMessage")[0]?.body.text).toContain(
      "Das Claude-Token in Dennis-Otto/control läuft in 21 Tagen ab, am 25.11.2026.",
    );
    const tomorrow = await world({
      language: "de",
      tokenExpires: "2026-11-05",
    });
    await runSchedule(tomorrow.context);
    expect(tomorrow.net.telegram("sendMessage")[0]?.body.text).toContain(
      "läuft in 1 Tag ab, am 05.11.2026.",
    );
  });
});
