// The social preview, .github/social-preview.html, draws messages of the pager as
// Telegram shows them. Each is the text that render() writes and the keyboard that
// keyboard() offers for a thing, so the picture can't keep a word, an emoji or a
// button that the pager no longer has: change the page with the pager, and the
// screenshot bot renders .github/social-preview.png anew.
import { describe, expect, it } from "vitest";

import page from "../.github/social-preview.html?raw";
import { keyboard } from "../src/buttons.ts";
import { render } from "../src/render.ts";
import type { Item } from "../src/store.ts";
import { texts } from "../src/texts.ts";
import { base, START } from "./helpers.ts";

const en = texts("en");

/** The things whose messages the preview draws, by their data-message in the page. */
const THINGS = {
  alarm: {
    ...base("alarm"),
    repo: "Dennis-Otto/homedarts-for-autodarts",
    kind: "alarm",
    state: "recovered",
    entries: [],
  },
  release: {
    ...base("release"),
    repo: "Dennis-Otto/paperless-sync",
    kind: "release",
    state: "ready",
    number: 312,
    version: "1.7.0",
    sha: "4f1c2ab",
    url: "https://github.com/Dennis-Otto/paperless-sync/pull/312",
    notes: {
      lines: [
        { heading: "Features" },
        { item: "Tags renamed in Paperless follow in Nextcloud (#305)" },
        { item: "A share link for every synced document (#309)" },
      ],
      more: 0,
      breaking: false,
    },
  },
} satisfies Record<string, Item>;

/** The two groups of each match of a pattern, such as a name and its text. */
function pairs(text: string, pattern: RegExp): [string, string][] {
  return [...text.matchAll(pattern)].map(([, first = "", second = ""]) => [
    first,
    second,
  ]);
}

/** Each text of a message in the page, by its data-message. */
function messages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [name, text] of pairs(
    page,
    /<div class="text" data-message="(\w+)">([\s\S]*?)<\/div>/g,
  )) {
    expect(found.has(name), `a second text of ${name}`).toBe(false);
    found.set(name, text);
  }
  return found;
}

/** The labels of the buttons of each message in the page, row by row. */
function keyboards(): Map<string, string[][]> {
  const found = new Map<string, string[][]>();
  for (const [name, row] of pairs(
    page,
    /<div class="row" data-message="(\w+)">([\s\S]*?)<\/div>/g,
  )) {
    const labels = [...row.matchAll(/<span>([^<]*)<\/span>/g)].map(
      ([, label = ""]) => label,
    );
    found.set(name, [...(found.get(name) ?? []), labels]);
  }
  return found;
}

/** A message as the page draws it: the HTML of Telegram, without the addresses of its links. */
function drawn(item: Item): string {
  return render(item, START, en).replace(/<a href="[^"]*">/g, "<a>");
}

describe("the social preview", () => {
  it("draws each message as the pager writes it", () => {
    const shown = messages();
    expect([...shown.keys()].sort()).toEqual(Object.keys(THINGS).sort());
    for (const [name, item] of Object.entries(THINGS)) {
      expect(shown.get(name), name).toBe(drawn(item));
    }
  });

  it("draws the buttons that each message offers", () => {
    const shown = keyboards();
    for (const name of shown.keys()) {
      expect(THINGS, name).toHaveProperty(name);
    }
    for (const [name, item] of Object.entries(THINGS)) {
      const offered = keyboard(item, en).map((row) =>
        row.map((button) => button.text),
      );
      expect(shown.get(name) ?? [], name).toEqual(offered);
    }
  });

  it("draws the release ready to merge and the alarm green again", () => {
    // The two states that the three lines of the preview promise: a button that
    // acts, and a message that the pager edited in place.
    expect(drawn(THINGS.release)).toContain(en("message.ready"));
    expect(
      keyboard(THINGS.release, en)
        .flat()
        .map((button) => button.text),
    ).toContain(en("button.merge"));
    expect(drawn(THINGS.alarm)).toContain(en("state.recovered"));
    expect(keyboard(THINGS.alarm, en)).toEqual([]);
  });
});
