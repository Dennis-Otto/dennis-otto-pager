// The pictures of the chat, docs/images/screenshots/chat-*.png, show messages of the
// pager as Telegram shows them, in English and in German. .github/chat.html draws
// them from .github/chat.js, which this test writes from render() of src/render.ts,
// keyboard() of src/buttons.ts and topicName() of src/topics.ts, so the pictures
// can't keep a word, an emoji or a button that the pager no longer has: a change of
// a text fails here until `npx vitest run test/chat.test.ts --update` writes the
// file anew, and the screenshot bot then renders the pictures anew.
import { describe, expect, it } from "vitest";

import { keyboard } from "../src/buttons.ts";
import { render } from "../src/render.ts";
import type { Alarm, Contribution, Item, Release } from "../src/store.ts";
import { LANGUAGES, type Language, type Texts, texts } from "../src/texts.ts";
import { COLORS, topicName } from "../src/topics.ts";
import { notesKey } from "../src/translations.ts";
import { base, START } from "./helpers.ts";

/** A message of the pager in the chat: its text, the labels of its buttons and its time. */
interface Message {
  text: string;
  buttons: string[][];
  /** Its time, with Telegram's mark in front once the pager edited it in place. */
  time: string;
}

/** A line of Telegram between messages, such as what a press changed. */
interface Service {
  service: string;
}

/** A topic in the list of topics: its name, the color of its icon, its newest line and its time. */
interface Row {
  name: string;
  color: string;
  last: string;
  time: string;
}

/** One picture: the head of the chat, and the messages of a topic or the list of topics. */
interface Scene {
  title: string;
  subtitle: string;
  messages?: (Message | Service)[];
  topics?: Row[];
}

/**
 * The words of the pictures that the pager doesn't write: Telegram's own, and the
 * line between two states of one message, which Telegram edits in place.
 */
const TELEGRAM: Record<
  Language,
  { edited: string; bot: string; after: string }
> = {
  en: {
    edited: "edited",
    bot: "bot",
    after: "The same message, a minute after {button}",
  },
  de: {
    edited: "bearbeitet",
    bot: "Bot",
    after: "Dieselbe Nachricht, eine Minute nach {button}",
  },
};

/** What the things of the pictures say, which comes from GitHub, in each language. */
const SAYS = {
  en: {
    title: "Sync stops when a tag has a slash",
    excerpt:
      "Since 1.6.2 the sync stops at the first document with a tag like Tax/2026. The log says: invalid path.",
    draft:
      "Thanks for the clear report, @sam-lee! A slash in a tag became a folder in the path; the fix is in #318 and comes with 1.7.1.",
    notes: [
      "Tags renamed in Paperless follow in Nextcloud (#305)",
      "A share link for every synced document (#309)",
    ],
    question: "Which release goes first?",
  },
  de: {
    title: "Sync bricht bei einem Tag mit Schrägstrich ab",
    excerpt:
      "Seit 1.6.2 bricht der Sync beim ersten Dokument mit einem Tag wie Steuer/2026 ab. Im Log steht: invalid path.",
    draft:
      "Danke für den genauen Bericht, @sam-lee! Ein Schrägstrich im Tag wurde zum Ordner im Pfad; der Fix ist in #318 und kommt mit 1.7.1.",
    notes: [
      "In Paperless umbenannte Tags folgen in Nextcloud (#305)",
      "Ein Freigabelink für jedes synchronisierte Dokument (#309)",
    ],
    question: "Welches Release geht zuerst?",
  },
} as const;

/** An alarm of main: a release that failed in a run, which 🔁 Rerun runs again, and a required check. */
function alarm(t: Texts): Alarm {
  return {
    ...base("alarm"),
    repo: "Dennis-Otto/repo-blueprint",
    kind: "alarm",
    state: "open",
    entries: [
      {
        key: "workflow:.github/workflows/release.yml",
        label: t("entry.release", { name: "Release" }),
        url: "https://github.com/Dennis-Otto/repo-blueprint/actions/runs/4711",
        run: 4711,
      },
      {
        key: "check:Socket Security",
        label: t("entry.check", { name: "Socket Security", branch: "main" }),
        url: "https://github.com/Dennis-Otto/repo-blueprint/runs/815",
      },
    ],
  };
}

/** An issue of someone else, as it comes and once its draft came. */
function contribution(language: Language): Contribution {
  const says = SAYS[language];
  return {
    ...base("contribution"),
    repo: "Dennis-Otto/paperless-sync",
    kind: "contribution",
    state: "new",
    number: 316,
    pull: false,
    title: says.title,
    url: "https://github.com/Dennis-Otto/paperless-sync/issues/316",
    author: "sam-lee",
    excerpt: says.excerpt,
    draft: null,
    draftVersion: 0,
  };
}

/** A release pull request whose checks are green, with its notes in the language of the pager. */
function release(language: Language): Release {
  const notes = {
    lines: [
      { heading: "Features" },
      { item: SAYS.en.notes[0] },
      { item: SAYS.en.notes[1] },
    ],
    more: 0,
    breaking: false,
  };
  return {
    ...base("release"),
    repo: "Dennis-Otto/paperless-sync",
    kind: "release",
    state: "ready",
    number: 312,
    version: "1.7.0",
    sha: "4f1c2ab",
    url: "https://github.com/Dennis-Otto/paperless-sync/pull/312",
    notes,
    ...(language === "en"
      ? {}
      : {
          translation: {
            of: notesKey(notes),
            language,
            lines: [...SAYS[language].notes],
          },
        }),
  };
}

/** A message as the chat shows it: the HTML of Telegram, without the addresses of its links. */
function message(item: Item, t: Texts, time: string): Message {
  return {
    text: render(item, START, t).replace(/<a href="[^"]*">/g, "<a>"),
    buttons: keyboard(item, t).map((row) => row.map((button) => button.text)),
    time,
  };
}

/** The last line of a message as plain text, as the list of topics shows it. */
function lastLine(item: Item, t: Texts): string {
  const lines = render(item, START, t)
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "");
  return (lines.at(-1) ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** The things of the list of topics, newest first, each with its time. */
function topics(language: Language, t: Texts): [Item, string][] {
  return [
    [alarm(t), "10:42"],
    [release(language), "09:15"],
    [contribution(language), "08:31"],
    [
      {
        ...base("decision"),
        kind: "decision",
        state: "open",
        ask: "night-run",
        question: SAYS[language].question,
        options: ["paperless-sync 1.7.0", "issue-assistant 2.3.0"],
        choice: null,
      },
      "08:05",
    ],
    [
      {
        ...base("workflow"),
        repo: "Dennis-Otto/issue-assistant",
        kind: "workflow",
        state: "recovered",
        path: ".github/workflows/links.yml",
        name: "Links",
        branch: "main",
        run: 912,
        attempt: 2,
        url: "https://github.com/Dennis-Otto/issue-assistant/actions/runs/912",
        jobs: [],
        count: 2,
        since: START - 3 * 3600000,
        last: START - 3600000,
      },
      "07:58",
    ],
  ];
}

/** Every picture in one language. */
function scenes(language: Language): Record<string, Scene> {
  const t = texts(language);
  const words = TELEGRAM[language];
  const asked = contribution(language);
  const drafted: Contribution = {
    ...asked,
    state: "draft",
    draft: SAYS[language].draft,
    draftVersion: 1,
  };
  return {
    alarm: {
      title: topicName(alarm(t), t),
      subtitle: "Repo Pager",
      messages: [message(alarm(t), t, "10:42")],
    },
    contribution: {
      title: topicName(asked, t),
      subtitle: "Repo Pager",
      messages: [
        message(asked, t, "08:31"),
        { service: words.after.replace("{button}", t("button.draft")) },
        message(drafted, t, `${words.edited} 08:31`),
      ],
    },
    release: {
      title: topicName(release(language), t),
      subtitle: "Repo Pager",
      messages: [message(release(language), t, "09:15")],
    },
    topics: {
      title: "Repo Pager",
      subtitle: words.bot,
      topics: topics(language, t).map(([item, time]) => ({
        name: topicName(item, t),
        color: `#${COLORS[item.kind].toString(16).padStart(6, "0")}`,
        last: lastLine(item, t),
        time,
      })),
    },
  };
}

describe("the pictures of the chat", () => {
  it("show each message as the pager writes it", async () => {
    const chat = Object.fromEntries(
      LANGUAGES.map((language) => [language, scenes(language)]),
    );
    await expect(
      `// Written by test/chat.test.ts from the texts of the pager; .github/chat.html draws it.\nwindow.CHAT = ${JSON.stringify(chat, null, 2)};\n`,
    ).toMatchFileSnapshot("../.github/chat.js");
  });

  it("show the buttons that the README and the website talk about", () => {
    // The alarm acts with 🔁 Rerun and 🛠 Start fix, the contribution goes from
    // ✍️ Draft a reply to ✅ Send, and the release offers 🔀 Merge, in each language.
    for (const language of LANGUAGES) {
      const t = texts(language);
      const shown = scenes(language);
      const labels = (name: string) =>
        (shown[name]?.messages ?? []).map((data) =>
          "buttons" in data ? data.buttons.flat() : [],
        );
      expect(labels("alarm")).toEqual([
        expect.arrayContaining([t("button.rerun"), t("button.fix")]),
      ]);
      expect(labels("contribution")).toEqual([
        expect.arrayContaining([t("button.draft")]),
        [],
        expect.arrayContaining([t("button.send")]),
      ]);
      expect(labels("release")).toEqual([
        expect.arrayContaining([t("button.merge")]),
      ]);
      expect(shown.topics?.topics?.map((row) => row.name)).toContain(
        topicName(alarm(t), t),
      );
    }
  });
});
