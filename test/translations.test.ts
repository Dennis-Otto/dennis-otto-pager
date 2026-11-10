// The notes of a release in the language of the pager: the headings from the
// catalog, the items from the control repository, checked against their English,
// and the message edited in place once they come, without a notification.
import { describe, expect, it, vi } from "vitest";

import { NOTES_MARK, type ReleaseNotes } from "../src/content.ts";
import { handleControl } from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import { apply } from "../src/pager.ts";
import type { Signal } from "../src/rules.ts";
import { type Item, itemId, keys, type Release } from "../src/store.ts";
import { texts } from "../src/texts.ts";
import {
  checked,
  heading,
  MAX_TRANSLATED_LINE,
  notesKey,
  shownNotes,
  toTranslate,
} from "../src/translations.ts";
import {
  base,
  json,
  REPO,
  START,
  type World,
  withControl,
  withTopics,
  world,
} from "./helpers.ts";

const de = texts("de");
const en = texts("en");
const at = { repo: REPO, installation: 9 };
const check: Signal = { ...at, type: "release-check", numbers: [30] };
const PULL = `/repos/${REPO}/pulls/30`;

/** The body of a release pull request of the blueprint's release-please, with its notes. */
const BODY = [
  "The next release.",
  "",
  NOTES_MARK,
  "",
  `## [1.16.0](https://github.com/${REPO}/compare/v1.15.1...v1.16.0) (2026-11-10)`,
  "",
  "### Features",
  "",
  `* **deps:** the weekly refresh of the lock files merges by itself ([#791](https://github.com/${REPO}/issues/791)) ([abc1234](https://github.com/${REPO}/commit/abc1234))`,
  `* every repository checks that two records of a decision can't share a number ([#773](https://github.com/${REPO}/issues/773))`,
  "",
  "### Bug fixes",
  "",
  `* **deps:** update dependency anchore/syft to v1.56.0 ([#789](https://github.com/${REPO}/issues/789))`,
  "",
  "---",
  "This PR was generated with Release Please.",
].join("\n");

const ENGLISH = [
  "the weekly refresh of the lock files merges by itself #791",
  "every repository checks that two records of a decision can't share a number #773",
  "update dependency anchore/syft to v1.56.0 #789",
] as const;

const GERMAN = [
  "die wöchentliche Auffrischung der Lock-Dateien merged von selbst #791",
  "jedes Repository prüft, dass zwei Entscheidungen keine Nummer teilen #773",
  "Abhängigkeit anchore/syft auf v1.56.0 aktualisiert #789",
] as const;

/** The notes of BODY, as the record of its release keeps them. */
const NOTES: ReleaseNotes = {
  lines: [
    { heading: "Features" },
    { item: `deps: ${ENGLISH[0]}` },
    { item: ENGLISH[1] },
    { heading: "Bug fixes" },
    { item: `deps: ${ENGLISH[2]}` },
  ],
  more: 0,
  breaking: false,
};

/** The release pull request, as GitHub answers for it, ready to merge. */
function pull(extra: object = {}) {
  return {
    number: 30,
    state: "open",
    title: "chore: release 1.16.0",
    body: BODY,
    draft: false,
    mergeable_state: "clean",
    html_url: `https://github.com/${REPO}/pull/30`,
    head: { ref: "release-please--branches--main", sha: "abc" },
    base: { ref: "main", repo: { default_branch: "main" } },
    ...extra,
  };
}

/** A pager in a language, whose control repository takes its events. */
async function pager(language: "en" | "de" = "de"): Promise<World> {
  const w = await world({ language });
  withTopics(w.net);
  withControl(w.net).on(
    "POST",
    "/repos/Dennis-Otto/control/dispatches",
    () => new Response(null, { status: 204 }),
  );
  w.net.on("GET", PULL, () => json(pull()));
  return w;
}

async function send(w: World, value: unknown) {
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
  return { status: response.status, text: await response.text() };
}

const asked = (w: World) =>
  w.net
    .github("/dispatches")
    .filter((call) => call.body.event_type === "pager-translate");

describe("the headings of the notes", () => {
  it("stay as they are in English", () => {
    expect(heading("Bug Fixes", en)).toBe("Bug Fixes");
  });

  it("come from the catalog in German, with the emoji in front", () => {
    expect(heading("Features", de)).toBe("Neue Funktionen");
    expect(heading("Bug Fixes", de)).toBe("Fehlerbehebungen");
    expect(heading("Performance  Improvements", de)).toBe("Leistung");
    expect(heading("⚠ BREAKING CHANGES", de)).toBe("⚠ Inkompatible Änderungen");
    expect(heading("⚠️ Breaking changes", de)).toBe("⚠️ Inkompatible Änderungen");
  });

  it("keep a heading that names no kind of change", () => {
    expect(heading("Highlights", de)).toBe("Highlights");
    expect(heading("constructor", de)).toBe("constructor");
  });
});

describe("the lines of a translation", () => {
  it("are the words of each item and text, without their scope", () => {
    expect(toTranslate(NOTES)).toEqual(ENGLISH);
    expect(
      toTranslate({
        lines: [{ text: "fix(ci)!: a text" }, { item: "Note: as it is" }],
        more: 0,
        breaking: false,
      }),
    ).toEqual(["a text", "Note: as it is"]);
    expect(toTranslate(undefined)).toEqual([]);
  });

  it("name their notes by a key that changes with them", () => {
    expect(notesKey(NOTES)).toMatch(/^[0-9a-f]{8}$/);
    expect(notesKey({ ...NOTES, more: 3 })).toBe(notesKey(NOTES));
    expect(notesKey({ ...NOTES, lines: NOTES.lines.slice(1) })).not.toBe(
      notesKey(NOTES),
    );
  });

  it("take each line that keeps its references and names, folded", () => {
    expect(checked(NOTES, [`  ${GERMAN[0]}\n`, GERMAN[1], GERMAN[2]])).toEqual(
      GERMAN,
    );
  });

  it("keep the English of a line that loses a reference or a name, says nothing or is too long", () => {
    expect(
      checked(NOTES, [
        "die wöchentliche Auffrischung merged von selbst #792",
        " ",
        "Abhängigkeit anchore-syft auf v1.56.0 aktualisiert #789",
      ]),
    ).toEqual(ENGLISH);
    expect(
      checked(NOTES, [
        `${"x".repeat(MAX_TRANSLATED_LINE)} #791`,
        GERMAN[1],
        "Abhängigkeit anchore/syft auf v1.56 aktualisiert #789",
      ]),
    ).toEqual([ENGLISH[0], GERMAN[1], ENGLISH[2]]);
  });

  it("take a line without the names that only look like code", () => {
    const notes: ReleaseNotes = {
      lines: [{ item: "a button, e.g. Merge, in Node.js (see .github)" }],
      more: 0,
      breaking: false,
    };
    expect(
      checked(notes, ["ein Knopf, z. B. Merge, in Node.js (siehe .github)"]),
    ).toEqual(["ein Knopf, z. B. Merge, in Node.js (siehe .github)"]);
    expect(checked(notes, ["ein Knopf, z. B. Merge, in Node"])).toEqual([
      "a button, e.g. Merge, in Node.js (see .github)",
    ]);
  });

  it("refuse an answer with another number of lines, or one too long in all", () => {
    expect(checked(NOTES, GERMAN.slice(1))).toBeNull();
    const long: ReleaseNotes = {
      lines: Array.from({ length: 6 }, (_, at) => ({ item: `item ${at}` })),
      more: 0,
      breaking: false,
    };
    expect(
      checked(
        long,
        Array.from({ length: 6 }, () => "y".repeat(MAX_TRANSLATED_LINE)),
      ),
    ).toBeNull();
  });

  it("show in English what has no translation of these notes, with the headings of the catalog", () => {
    const notes: ReleaseNotes = {
      lines: [{ heading: "Features" }, { item: "deps: one" }, { text: "two" }],
      more: 0,
      breaking: false,
    };
    expect(shownNotes(notes, undefined, de)).toEqual([
      { heading: "Neue Funktionen" },
      { item: "deps: one" },
      { text: "two" },
    ]);
    expect(shownNotes(notes, { of: notesKey(notes) }, de)).toEqual(
      shownNotes(notes, undefined, de),
    );
    expect(
      shownNotes(notes, { of: notesKey(NOTES), lines: ["eins", "zwei"] }, de),
    ).toEqual(shownNotes(notes, undefined, de));
    expect(
      shownNotes(notes, { of: notesKey(notes), lines: ["eins", "zwei"] }, de),
    ).toEqual([
      { heading: "Neue Funktionen" },
      { item: "deps: eins" },
      { text: "zwei" },
    ]);
  });
});

describe("a release in a German pager", () => {
  it("shows its notes in English first, asks for them in German, and edits its message in place", async () => {
    const w = await pager();
    expect(await apply(w.context, check)).toBe("#30 ready");
    const first = w.net.telegram("sendMessage")[0]?.body.text as string;
    expect(first).toContain("<b>Neue Funktionen</b>\n• deps: the weekly");
    expect(first).toContain("<b>Fehlerbehebungen</b>");
    const id = await itemId(keys.release(REPO));
    const of = notesKey(NOTES);
    expect(asked(w).map((call) => call.body.client_payload)).toEqual([
      {
        item: id,
        repo: REPO,
        number: 30,
        version: "1.16.0",
        of,
        lines: ENGLISH,
        language: "de",
      },
    ]);
    expect(
      await send(w, { type: "translation", item: id, of, lines: GERMAN }),
    ).toEqual({ status: 200, text: "translated" });
    const edited = w.net.telegram("editMessageText").at(-1)?.body.text;
    expect(edited).toContain(
      `<b>Neue Funktionen</b>\n• deps: die wöchentliche Auffrischung der Lock-Dateien merged von selbst <a href="https://github.com/${REPO}/issues/791">#791</a>`,
    );
    expect(edited).toContain("• deps: Abhängigkeit anchore/syft auf v1.56.0");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    // The same answer again changes nothing.
    const edits = w.net.telegram("editMessageText").length;
    expect(
      await send(w, { type: "translation", item: id, of, lines: ENGLISH }),
    ).toEqual({ status: 200, text: "translated" });
    expect(w.net.telegram("editMessageText")).toHaveLength(edits);
    // A new head with the same notes keeps the translation and asks nothing.
    w.net.on("GET", PULL, () =>
      json(
        pull({ head: { ref: "release-please--branches--main", sha: "def" } }),
      ),
    );
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      "die wöchentliche Auffrischung",
    );
    expect(asked(w)).toHaveLength(1);
    expect((await w.context.store.get(id)) as Release).toMatchObject({
      sha: "def",
      translation: { of, lines: GERMAN },
    });
  });

  it("asks again for notes that changed", async () => {
    const w = await pager();
    await apply(w.context, check);
    w.net.on("GET", PULL, () =>
      json(pull({ body: BODY.replace("by itself", "on its own") })),
    );
    await apply(w.context, check);
    expect(asked(w).map((call) => call.body.client_payload.lines[0])).toEqual([
      ENGLISH[0],
      "the weekly refresh of the lock files merges on its own #791",
    ]);
  });

  it("asks nothing for notes without items, or without notes", async () => {
    const w = await pager();
    w.net.on("GET", PULL, () =>
      json(pull({ body: `${NOTES_MARK}\n\n### Features\n` })),
    );
    expect(await apply(w.context, check)).toBe("#30 ready");
    w.net.on("GET", PULL, () => json(pull({ body: "No notes." })));
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(asked(w)).toHaveLength(0);
  });

  it("asks nothing in an English pager", async () => {
    const w = await pager("en");
    await apply(w.context, check);
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "<b>Features</b>\n• deps: the weekly",
    );
    expect(asked(w)).toHaveLength(0);
  });

  it("keeps the English when the ask can't go, and says why in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const w = await world({ language: "de" });
    withTopics(w.net).on("GET", PULL, () => json(pull()));
    expect(await apply(w.context, check)).toBe("#30 ready");
    withControl(w.net).on("POST", "/repos/Dennis-Otto/control/dispatches", () =>
      json({ message: "Validation Failed" }, 422),
    );
    w.net.on("GET", PULL, () =>
      json(
        pull({ head: { ref: "release-please--branches--main", sha: "def" } }),
      ),
    );
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      `The notes of ${REPO}#30 stay in English: the app isn't installed on the control repository`,
      expect.stringMatching(
        new RegExp(`^The notes of ${REPO}#30 stay in English: .*Validation`),
      ),
    ]);
    expect(
      (await w.context.store.get(await itemId(keys.release(REPO))))?.kind,
    ).toBe("release");
    expect(
      ((await w.context.store.get(await itemId(keys.release(REPO)))) as Release)
        .translation,
    ).toBeUndefined();
    warn.mockRestore();
  });

  it("passes on a broken network", async () => {
    const w = await world({ language: "de" });
    withTopics(w.net).on("GET", PULL, () => json(pull()));
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => {
        throw new TypeError("Network connection lost");
      },
    );
    await expect(apply(w.context, check)).rejects.toThrow(
      "Network connection lost",
    );
  });
});

describe("the answer with a translation", () => {
  const release: Release = {
    ...base("i0123456789abcde"),
    kind: "release",
    state: "ready",
    number: 30,
    version: "1.16.0",
    sha: "abc",
    url: `https://github.com/${REPO}/pull/30`,
    notes: NOTES,
    translation: { of: notesKey(NOTES) },
  };
  const answer = {
    type: "translation",
    item: release.id,
    of: notesKey(NOTES),
    lines: GERMAN,
  };

  it("is refused when it isn't one", async () => {
    const w = await pager();
    for (const wrong of [
      { ...answer, item: 3 },
      { ...answer, of: "notes" },
      { ...answer, of: 3 },
      { ...answer, lines: "eins" },
      { ...answer, lines: [] },
      { ...answer, lines: Array.from({ length: 16 }, () => "eins") },
      { ...answer, lines: ["eins", 2, "drei"] },
    ]) {
      expect(await send(w, wrong)).toEqual({
        status: 400,
        text: "Bad Request",
      });
    }
  });

  it("finds no release, or one without notes", async () => {
    const w = await pager();
    expect((await send(w, answer)).status).toBe(404);
    const { notes: _notes, ...without } = release;
    await w.context.store.put(without);
    expect((await send(w, answer)).status).toBe(404);
    const other: Item = {
      ...base(release.id),
      kind: "reminder",
      state: "open",
      text: "Renew the token.",
    };
    await w.context.store.put(other);
    expect((await send(w, answer)).status).toBe(404);
  });

  it("changes nothing for notes that the pager didn't ask for, or that changed since", async () => {
    const w = await pager();
    const { translation: _translation, ...unasked } = release;
    await w.context.store.put(unasked);
    expect((await send(w, answer)).status).toBe(409);
    await w.context.store.put({
      ...release,
      notes: { ...NOTES, lines: NOTES.lines.slice(0, 3) },
    });
    expect((await send(w, answer)).status).toBe(409);
    expect(w.net.telegram("editMessageText")).toHaveLength(0);
  });

  it("changes nothing when it doesn't fit the notes", async () => {
    const w = await pager();
    await w.context.store.put(release);
    expect(await send(w, { ...answer, lines: GERMAN.slice(1) })).toEqual({
      status: 422,
      text: "Unprocessable Content",
    });
    expect(
      ((await w.context.store.get(release.id)) as Release).translation,
    ).toEqual({ of: notesKey(NOTES) });
  });
});
