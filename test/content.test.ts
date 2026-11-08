// What a thing says: the start of the text of an issue, a pull request, a
// discussion or a comment, and the notes of a release from the body of its pull
// request, as release-please and the blueprint write it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  cut,
  excerpt,
  MAX_EXCERPT,
  MAX_NOTE_LINE,
  MAX_NOTE_LINES,
  MAX_NOTES_LENGTH,
  NOTES_MARK,
  releaseNotes,
  withoutComments,
} from "../src/content.ts";

const REPO = "https://github.com/Dennis-Otto/repo-blueprint";

/** The body of a release pull request of the blueprint's release-please, as GitHub has it. */
function releaseBody(
  notes: string,
  version = "1.12.0",
  before = "1.11.3",
): string {
  return [
    "The next release: its version follows from the titles of the pull requests merged since the last one. Merging this pull request publishes it.",
    "",
    NOTES_MARK,
    "---",
    "",
    "",
    `## [${version}](${REPO}/compare/v${before}...v${version}) (2026-11-08)`,
    "",
    "",
    notes,
    "",
    "---",
    "This PR was generated with [Release Please](https://github.com/googleapis/release-please). See [documentation](https://github.com/googleapis/release-please#release-please).",
    "",
    "<!-- BEGIN_COMMIT_OVERRIDE",
    `chore: release ${version} (#680)`,
    "",
    "BREAKING CHANGE: a major version, or a minor one while the version is",
    "below 1.0.0).",
    "END_COMMIT_OVERRIDE -->",
  ].join("\n");
}

/** An item as release-please lists it: its title, its pull request and its commit. */
function commitItem(title: string, number: number, sha = "1c7eb3c"): string {
  return `* ${title} ([#${number}](${REPO}/issues/${number})) ([${sha}](${REPO}/commit/${sha}0ecbf51a6980318c075666d2b09c06a04))`;
}

const FEATURES = [
  "### Features",
  "",
  commitItem(
    "a container image reaches SLSA Build Level 3 in an isolated workflow",
    681,
  ),
  commitItem("a new repository's README shows the badge", 686, "bb87554"),
  "",
  "",
  "### Bug fixes",
  "",
  commitItem("the Windows check passes on main again", 682, "de7899c"),
].join("\n");

describe("the start of a text", () => {
  it("is what GitHub shows, without the comments of an issue form", () => {
    const form = [
      "<!-- Thanks for the report! Fill in the fields below. -->",
      "### What happened?",
      "",
      "It crashes <b>on</b> start.   ",
      "<!--",
      "  A hint of the form",
      "-->",
      "",
      "",
      "",
      "### Version",
      "",
      "1.2.3",
    ].join("\r\n");
    expect(excerpt(form)).toBe(
      "### What happened?\n\nIt crashes <b>on</b> start.\n\n### Version\n\n1.2.3",
    );
  });

  it("is none for a body that says nothing", () => {
    expect(excerpt(undefined)).toBeUndefined();
    expect(excerpt(null)).toBeUndefined();
    expect(excerpt("")).toBeUndefined();
    expect(excerpt(" \n\t\n ")).toBeUndefined();
    expect(
      excerpt("<!-- only the hints of the template -->\n"),
    ).toBeUndefined();
  });

  it("hides the rest after a comment that never ends, as GitHub does", () => {
    expect(withoutComments("shown <!-- hidden")).toBe("shown ");
    expect(withoutComments("a<!--b-->c<!--d-->e")).toBe("ace");
    expect(withoutComments("<!---->")).toBe("");
  });

  it("is cut to its most characters, never inside an emoji", () => {
    const long = excerpt("x".repeat(2000)) as string;
    expect(long).toHaveLength(MAX_EXCERPT);
    expect(long.endsWith("x…")).toBe(true);
    const emoji = excerpt(`${"x".repeat(MAX_EXCERPT - 2)}😀😀`) as string;
    expect(emoji).toBe(`${"x".repeat(MAX_EXCERPT - 2)}…`);
    expect(cut("a😀b", 3)).toBe("a…");
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), (text) => {
        const start = excerpt(text);
        return start === undefined || start.length <= MAX_EXCERPT;
      }),
    );
  });

  it("reads a body of any size at once", () => {
    const begin = Date.now();
    expect(excerpt("<!--".repeat(200_000))).toBeUndefined();
    expect(excerpt(`a${" ".repeat(1000)}b`)).toBe(
      `a${" ".repeat(MAX_EXCERPT - 2)}…`,
    );
    expect(excerpt("<!---->".repeat(9000))).toBeUndefined();
    expect(Date.now() - begin).toBeLessThan(1000);
  });
});

describe("the notes of a release", () => {
  it("are what follows the mark of the blueprint, up to the footer of release-please", () => {
    expect(releaseNotes(releaseBody(FEATURES), "1.12.0")).toEqual({
      lines: [
        { heading: "Features" },
        {
          item: "a container image reaches SLSA Build Level 3 in an isolated workflow #681",
        },
        { item: "a new repository's README shows the badge #686" },
        { heading: "Bug fixes" },
        { item: "the Windows check passes on main again #682" },
      ],
      more: 0,
      // The commit override after the footer says BREAKING CHANGE, but in a comment.
      breaking: false,
    });
  });

  it("start after the first rule of a body without the mark", () => {
    const body = releaseBody(FEATURES).replace(NOTES_MARK, "");
    expect(releaseNotes(body, "1.12.0")?.lines).toHaveLength(5);
    expect(
      releaseNotes("## 1.0.0\n\n---\n\n### Features\n\n- New", "1.0.0"),
    ).toEqual({
      lines: [{ heading: "Features" }, { item: "New" }],
      more: 0,
      breaking: false,
    });
  });

  it("are none without the mark and without a rule", () => {
    expect(releaseNotes(undefined, "1.0.0")).toBeUndefined();
    expect(releaseNotes(null, "1.0.0")).toBeUndefined();
    expect(releaseNotes("", "1.0.0")).toBeUndefined();
    expect(releaseNotes("### Features\n\n* New", "1.0.0")).toBeUndefined();
    expect(releaseNotes(`${NOTES_MARK}\n---\n\n---\nfooter`, "1.0.0")).toEqual({
      lines: [],
      more: 0,
      breaking: false,
    });
  });

  it("take the fragments of the blueprint as they are", () => {
    const notes = [
      "### Features",
      "",
      "- When none of the buttons fits, write your answer with `node scripts/ask.mjs` in its **topic**.",
      "- A [discussion](https://github.com/Dennis-Otto/demo/discussions) closes, closes [#12](https://github.com/Dennis-Otto/demo/issues/12) and __more__.",
      "  It goes on in a second line.",
      "",
      "A paragraph of its own.",
      "and its second line.",
    ].join("\n");
    expect(releaseNotes(releaseBody(notes), "1.12.0")?.lines).toEqual([
      { heading: "Features" },
      {
        item: "When none of the buttons fits, write your answer with node scripts/ask.mjs in its topic.",
      },
      {
        item: "A discussion closes, closes #12 and more. It goes on in a second line.",
      },
      { text: "A paragraph of its own. and its second line." },
    ]);
  });

  it("know a breaking change by its section or by a new major version", () => {
    const section =
      "### ⚠ BREAKING CHANGES\n\n* **api:** the old flag is gone\n\n### Features\n\n* New";
    const notes = releaseNotes(releaseBody(section), "1.12.0");
    expect(notes?.breaking).toBe(true);
    expect(notes?.lines[0]).toEqual({ heading: "⚠ BREAKING CHANGES" });
    expect(notes?.lines[1]).toEqual({ item: "api: the old flag is gone" });
    expect(
      releaseNotes(releaseBody("### Breaking changes\n\n- Gone"), "1.12.0")
        ?.breaking,
    ).toBe(true);
    const plain = "### Features\n\n* New";
    expect(
      releaseNotes(releaseBody(plain, "2.0.0", "1.12.0"), "2.0.0")?.breaking,
    ).toBe(true);
    expect(
      releaseNotes(releaseBody(plain, "1.13.0", "1.12.0"), "1.13.0")?.breaking,
    ).toBe(false);
    // The step to 1.0.0 marks a version as stable, which breaks nothing by itself.
    expect(
      releaseNotes(releaseBody(plain, "1.0.0", "0.9.0"), "1.0.0")?.breaking,
    ).toBe(false);
    // A tag with its component, and a first release without a comparison.
    expect(
      releaseNotes(
        `${NOTES_MARK}\n---\n## [3.0.0](${REPO}/compare/pager-v2.1.0...pager-v3.0.0)\n\n${plain}`,
        "3.0.0",
      )?.breaking,
    ).toBe(true);
    expect(
      releaseNotes(
        `${NOTES_MARK}\n---\n## 0.1.0 (2026-11-03)\n\n${plain}`,
        "0.1.0",
      ),
    ).toEqual({
      lines: [{ heading: "Features" }, { item: "New" }],
      more: 0,
      breaking: false,
    });
    expect(
      releaseNotes(
        `${NOTES_MARK}\n---\n## [2.0.0](${REPO}/compare/main...v2.0.0)\n\n${plain}`,
        "2.0.0",
      )?.breaking,
    ).toBe(false);
  });

  it("show at most their lines and characters, and count the rest", () => {
    const many = Array.from({ length: 40 }, (_, n) =>
      commitItem(`change ${n}`, 100 + n),
    );
    const notes = releaseNotes(
      releaseBody(`### Features\n\n${many.join("\n")}`),
      "1.12.0",
    );
    expect(notes?.lines).toHaveLength(MAX_NOTE_LINES);
    expect(notes?.more).toBe(40 - (MAX_NOTE_LINES - 1));
    const long = Array.from(
      { length: 10 },
      (_, n) => `* ${n} ${"y".repeat(400)}`,
    );
    const cutNotes = releaseNotes(
      releaseBody(`### Features\n\n${long.join("\n")}`),
      "1.12.0",
    );
    const items = cutNotes?.lines.slice(1) ?? [];
    expect(items.length).toBeGreaterThan(0);
    for (const line of items) {
      expect("item" in line && line.item.length).toBe(MAX_NOTE_LINE);
    }
    const length = (cutNotes?.lines ?? []).reduce(
      (sum, line) =>
        sum +
        ("item" in line
          ? line.item.length + 2
          : "heading" in line
            ? line.heading.length
            : 0) +
        1,
      0,
    );
    expect(length).toBeLessThanOrEqual(MAX_NOTES_LENGTH);
    expect(cutNotes?.more).toBe(10 - items.length);
  });

  it("leave out a heading whose items don't fit", () => {
    const items = Array.from({ length: 14 }, (_, n) => `* ${n}`).join("\n");
    const notes = releaseNotes(
      releaseBody(`### Features\n\n${items}\n\n### Bug fixes\n\n* fixed`),
      "1.12.0",
    );
    expect(notes?.lines).toHaveLength(15);
    expect(notes?.lines.at(-1)).toEqual({ item: "13" });
    expect(notes?.more).toBe(1);
    const headings = Array.from({ length: 20 }, (_, n) => `### H${n}`).join(
      "\n",
    );
    expect(releaseNotes(releaseBody(`${headings}\n* last`), "1.12.0")).toEqual({
      lines: [],
      more: 1,
      breaking: false,
    });
  });

  it("read a body of any size at once", () => {
    const begin = Date.now();
    for (const filler of ["[", " ", "(", "#", "*", "-", "<!--"]) {
      releaseNotes(`${NOTES_MARK}\n---\n* ${filler.repeat(70_000)}`, "1.0.0");
      releaseNotes(
        `${NOTES_MARK}\n${`* ${filler.repeat(500)}\n`.repeat(200)}`,
        "1.0.0",
      );
    }
    expect(Date.now() - begin).toBeLessThan(2000);
  });
});
