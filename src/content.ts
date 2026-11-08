/**
 * What a thing says, for its message: the start of the text of an issue, a pull
 * request, a discussion or a comment, and the notes of a release, as the body of
 * its pull request of release-please has them. Both come from GitHub as someone
 * wrote them, so they are read as plain text: every input is cut first, every
 * loop over it is linear, and src/render.ts escapes what they keep, so no body can
 * add markup or make the Worker slow.
 */

/** The most characters of a body that the pager reads; GitHub keeps 65536 at most. */
const MAX_BODY = 65536;

/** The most characters of the start of a text that a message quotes. */
export const MAX_EXCERPT = 500;

/**
 * A text of at most max characters of UTF-16, cut between two characters, with …
 * at the end: never inside an emoji, whose half Telegram would refuse.
 */
export function cut(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  let kept = "";
  for (const character of text) {
    if (kept.length + character.length > max - 1) {
      break;
    }
    kept += character;
  }
  return `${kept}…`;
}

/**
 * A text without its comments of HTML, such as the hints of an issue form or of a
 * template of a pull request, which GitHub doesn't show either. A comment that
 * never ends hides the rest, as on GitHub.
 */
export function withoutComments(text: string): string {
  let kept = "";
  let at = 0;
  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open < 0) {
      return kept + text.slice(at);
    }
    kept += text.slice(at, open);
    const close = text.indexOf("-->", open + 4);
    if (close < 0) {
      return kept;
    }
    at = close + 3;
  }
}

/**
 * The start of the text of an issue, a pull request, a discussion or a comment, as
 * GitHub shows it: without its comments of HTML and its empty lines around, at most
 * MAX_EXCERPT characters; undefined when nothing is left.
 */
export function excerpt(body: string | null | undefined): string | undefined {
  const text = withoutComments((body ?? "").slice(0, MAX_BODY))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? undefined : cut(text, MAX_EXCERPT);
}

/** A line of the notes of a release: a heading, such as Features, an item below it, or a text. */
export type NoteLine =
  | { heading: string }
  | { item: string }
  | { text: string };

/** The notes of a release, as many lines as its message shows. */
export interface ReleaseNotes {
  lines: NoteLine[];
  /** How many items or texts of the notes the message leaves out. */
  more: number;
  /** Whether the notes have a section of breaking changes, or the major version goes up. */
  breaking: boolean;
}

/** The mark before the notes in the body of a release pull request of the blueprint's release-please. */
export const NOTES_MARK = "<!-- The notes of the release follow. -->";

/** The most lines of notes that a message shows. */
export const MAX_NOTE_LINES = 15;

/** The most characters of notes that a message shows. */
export const MAX_NOTES_LENGTH = 1200;

/** The most characters of one line of notes, so that one long item leaves room for others. */
export const MAX_NOTE_LINE = 300;

/** The most characters of one line of the body that the notes read. */
const MAX_LINE = 1000;

/** A line of the notes as it comes, before its Markdown is read. */
interface Raw {
  kind: "heading" | "item" | "text";
  text: string;
}

/** Where the notes start in the body of a release pull request, or null when it has none. */
function notesStart(body: string): number | null {
  const mark = body.indexOf(NOTES_MARK);
  if (mark >= 0) {
    return mark + NOTES_MARK.length;
  }
  const rule = /^---[ \t]*$/m.exec(body);
  return rule === null ? null : rule.index + rule[0].length;
}

/** The major part of a version, such as 1 of 1.12.0 or of v1.12.0, or null without one. */
function major(version: string): number | null {
  const found = /(\d+)\.\d+\.\d+/.exec(version);
  return found === null ? null : Number(found[1]);
}

/**
 * Whether the heading of a version names a major version above the one before,
 * as the link of release-please to the comparison of both tags says, such as
 * compare/v1.12.0...v2.0.0. The step from 0.x to 1.0.0 marks a version as stable,
 * which breaks nothing by itself: only the notes can say that it does.
 */
function majorUp(heading: string, version: string): boolean {
  const at = heading.indexOf("/compare/");
  if (at < 0) {
    return false;
  }
  const before = major(heading.slice(at + 9).split("...")[0] as string);
  const now = major(version);
  return before !== null && now !== null && before >= 1 && now > before;
}

/** Whether a heading is the version's own, such as "[1.2.3](…) (2026-11-08)". */
function isVersion(heading: string, version: string): boolean {
  const text = heading.replace(/^\[/, "").replace(/^v/, "");
  return version !== "" && text.startsWith(version);
}

/**
 * The text of a line of Markdown as the message shows it: a link to a commit,
 * which release-please adds to each item, goes, a link to a pull request or an
 * issue becomes its number, which the message links again, any other link its
 * text, and the marks of bold and code go.
 */
function plain(markdown: string): string {
  return markdown
    .replace(/ ?\(\[[0-9a-f]{7,40}\]\([^()\s]*\)\)/g, "")
    .replace(/\(\[#(\d+)\]\([^()\s]*\)\)/g, "#$1")
    .replace(/\[([^[\]]*)\]\([^()\s]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The lines of the notes of a release as they come, and whether a heading says that they break something. */
function rawLines(
  notes: string,
  version: string,
): { lines: Raw[]; breaking: boolean } {
  const lines: Raw[] = [];
  let breaking = false;
  let started = false;
  let ruled = false;
  let blank = true;
  for (const whole of notes.split("\n")) {
    const line = whole.slice(0, MAX_LINE).trim();
    if (line === "") {
      blank = true;
      continue;
    }
    // release-please puts a rule before its notes and one before its footer.
    if (/^-{3,}$/.test(line)) {
      if (started || ruled) {
        break;
      }
      ruled = true;
      continue;
    }
    started = true;
    const heading = /^#{1,6}\s+(.*)$/.exec(line)?.[1];
    const item = /^[*+-]\s+(.*)$/.exec(line)?.[1];
    const last = lines.at(-1);
    if (heading !== undefined) {
      if (isVersion(heading, version)) {
        breaking ||= majorUp(heading, version);
      } else {
        breaking ||= /breaking change/i.test(heading);
        lines.push({ kind: "heading", text: heading });
      }
    } else if (item !== undefined) {
      lines.push({ kind: "item", text: item });
    } else if (!blank && last !== undefined && last.kind !== "heading") {
      // A line that goes on with the item or the text above it.
      last.text = `${last.text} ${line}`.slice(0, MAX_LINE);
    } else {
      lines.push({ kind: "text", text: line });
    }
    blank = false;
  }
  return { lines, breaking };
}

/** A line of the notes for the message, in its own kind. */
function noteLine(raw: Raw): NoteLine {
  const text = cut(plain(raw.text), MAX_NOTE_LINE);
  switch (raw.kind) {
    case "heading":
      return { heading: text };
    case "item":
      return { item: text };
    default:
      return { text };
  }
}

/** How many characters a line of the notes takes in the message, with "• " before an item. */
function shownLength(line: NoteLine): number {
  if ("item" in line) {
    return line.item.length + 2;
  }
  return "heading" in line ? line.heading.length : line.text.length;
}

/**
 * The notes of a release from the body of its pull request: what follows the mark
 * of the blueprint's release-please, or the first rule when it has no mark, up to
 * the rule before the footer of release-please. As many lines as fit into
 * MAX_NOTE_LINES and MAX_NOTES_LENGTH, and none of the headings whose items don't;
 * undefined when the body has no notes.
 */
export function releaseNotes(
  body: string | null | undefined,
  version: string,
): ReleaseNotes | undefined {
  const text = (body ?? "").slice(0, MAX_BODY).replace(/\r\n?/g, "\n");
  const start = notesStart(text);
  if (start === null) {
    return undefined;
  }
  const { lines, breaking } = rawLines(
    withoutComments(text.slice(start)),
    version,
  );
  const shown: NoteLine[] = [];
  let length = 0;
  for (const raw of lines) {
    const line = noteLine(raw);
    const size = shownLength(line) + 1;
    if (shown.length === MAX_NOTE_LINES || length + size > MAX_NOTES_LENGTH) {
      break;
    }
    shown.push(line);
    length += size;
  }
  // A heading at the end would stand without its items.
  while (shown.length > 0 && "heading" in (shown.at(-1) as NoteLine)) {
    shown.pop();
  }
  const all = lines.filter((line) => line.kind !== "heading").length;
  const listed = shown.filter((line) => !("heading" in line)).length;
  return { lines: shown, more: all - listed, breaking };
}
