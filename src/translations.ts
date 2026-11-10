/**
 * The notes of a release in the language of the pager. The repositories write their
 * changelogs in English, and GitHub keeps them so: a pager in another language
 * shows them in its own. What is fixed, the headings of the kinds of change, such
 * as Features, it words itself from its catalog. The words of the items come from
 * the control repository, whose Claude translates them, and the pager trusts that
 * answer no further than any other: a translated line that lost a reference, such
 * as #791, or a name of code, such as anchore/syft or v1.56.0, keeps its English,
 * and the scope in front of an item, such as "deps: ", never goes to translation,
 * so the message never links less or names something else than the notes say.
 */
import {
  MAX_NOTE_LINE,
  MAX_NOTES_LENGTH,
  type NoteLine,
  type ReleaseNotes,
} from "./content.ts";
import type { Key, Language, Texts } from "./texts.ts";

/** The language in which the repositories write their notes, which needs no translation. */
export const NOTES_LANGUAGE = "en";

/** The most characters of the words of one translated line: German takes more than English. */
export const MAX_TRANSLATED_LINE = MAX_NOTE_LINE + MAX_NOTE_LINE / 2;

/**
 * The most characters of all the lines of translated notes together, scopes
 * included: twice the English, so that the message still fits within the 4096
 * characters of Telegram.
 */
export const MAX_TRANSLATED = 2 * MAX_NOTES_LENGTH;

/** The most characters of a line of notes as the message shows it, translated or not. */
export const MAX_SHOWN_LINE = MAX_NOTE_LINE + MAX_TRANSLATED_LINE;

/** The notes of a release in the language of the pager, as the record of the release keeps them. */
export interface Translation {
  /** The notes that it translates, by notesKey(). */
  of: string;
  /**
   * The language that it translates them into, the pager's when it asked: a pager
   * that speaks another language since shows the notes in English, or asks again.
   */
  language: Language;
  /**
   * Each line of those notes that is no heading, in their order, without its
   * scope; none while the control repository translates them.
   */
  lines?: string[];
}

/**
 * The headings of the kinds of change, in lower case, and the key of each in the
 * catalog: those of release-please, of the blueprint and of Keep a Changelog.
 */
const HEADINGS = {
  "breaking changes": "notes.breaking",
  features: "notes.features",
  added: "notes.added",
  changes: "notes.changes",
  changed: "notes.changed",
  deprecated: "notes.deprecated",
  removed: "notes.removed",
  "bug fixes": "notes.fixes",
  fixed: "notes.fixed",
  performance: "notes.performance",
  "performance improvements": "notes.performance",
  security: "notes.security",
  reverts: "notes.reverts",
  documentation: "notes.documentation",
  "code refactoring": "notes.refactoring",
  tests: "notes.tests",
  "build system": "notes.build",
  "continuous integration": "notes.ci",
  miscellaneous: "notes.miscellaneous",
  "miscellaneous chores": "notes.miscellaneous",
  style: "notes.style",
  styles: "notes.style",
  dependencies: "notes.dependencies",
} as const satisfies Readonly<Record<string, Key>>;

/**
 * A heading of the notes in the language of the pager, such as "Neue Funktionen"
 * for "Features", with the emoji in front of it, such as the ⚠ of release-please's
 * breaking changes. A heading that names no kind of change stays as it is.
 */
export function heading(text: string, t: Texts): string {
  if (t.language === NOTES_LANGUAGE) {
    return text;
  }
  const [, mark, words] =
    /^((?:\p{Extended_Pictographic}|\u{FE0F}|\s)*)(.*)$/u.exec(
      text,
    ) as RegExpExecArray;
  const name = (words as string).toLowerCase().replace(/\s+/g, " ").trim();
  // Only an own key: "constructor" or "__proto__" would find the prototype's.
  return Object.hasOwn(HEADINGS, name)
    ? `${mark}${t(HEADINGS[name as keyof typeof HEADINGS])}`
    : text;
}

/** The text of a line of notes that is no heading. */
function textOf(line: Exclude<NoteLine, { heading: string }>): string {
  return "item" in line ? line.item : line.text;
}

/**
 * A line of notes, split into its scope, such as "deps: " or "fix(ci): ", which
 * stays as it is, and the words that a translation translates.
 */
function split(text: string): { scope: string; words: string } {
  const scope = /^[a-z][\w.-]*(?:\([^()]{1,50}\))?!?: /.exec(text)?.[0] ?? "";
  return { scope, words: text.slice(scope.length) };
}

/** The text of each line of the notes that is no heading, in their order. */
function bodies(notes: ReleaseNotes | undefined): string[] {
  return (notes?.lines ?? []).flatMap((line) =>
    "heading" in line ? [] : [textOf(line)],
  );
}

/** What a translation translates: the words of each line of the notes that is no heading. */
export function toTranslate(notes: ReleaseNotes | undefined): string[] {
  return bodies(notes).map((text) => split(text).words);
}

/**
 * The key of the notes of a release, which a translation names: notes that changed,
 * such as by an edit of the pull request, have another one. A hash of FNV-1a over
 * their lines, which tells notes apart and proves nothing: the answer that names it
 * is signed.
 */
export function notesKey(notes: ReleaseNotes): string {
  const text = JSON.stringify(notes.lines);
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The numbers that the message links in a line, such as 791 of "#791", in order. */
function references(text: string): string {
  return [...text.matchAll(/(?:^|[\s(])#(\d{1,7})\b/g)]
    .map((found) => found[1])
    .sort()
    .join(" ");
}

/**
 * The names of code in a line, which a translation keeps as they are: a word with
 * a slash, an underscore or an @, a version such as v1.56.0, a name of a hidden
 * file such as .github, or a file or a name with a dot such as check.sh or
 * Node.js, without the marks around it; "e.g." is none.
 */
function names(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) =>
      word.replace(/^["'(«„“]+/, "").replace(/["'),.:;!?»“”]+$/, ""),
    )
    .filter((word) =>
      /[/_@]|\d\.\d|^\.\w|[A-Za-z0-9]{2,}\.[A-Za-z0-9]/.test(word),
    );
}

/**
 * The lines of a translation that the message shows, one for each line that the
 * notes translate: each as the control repository sent it, folded and trimmed,
 * when it says something, fits MAX_TRANSLATED_LINE and keeps every reference and
 * every name of code of its English line, and that English line otherwise. Null
 * when the answer doesn't fit the notes: another number of lines, or more than
 * MAX_TRANSLATED characters in all.
 */
export function checked(
  notes: ReleaseNotes,
  translated: readonly string[],
): string[] | null {
  const english = toTranslate(notes);
  if (translated.length !== english.length) {
    return null;
  }
  const lines = english.map((line, at) => {
    const words = (translated[at] as string).replace(/\s+/g, " ").trim();
    const keeps =
      words !== "" &&
      words.length <= MAX_TRANSLATED_LINE &&
      references(words) === references(line) &&
      names(line).every((name) => words.includes(name));
    return keeps ? words : line;
  });
  const scopes = bodies(notes).map((text) => split(text).scope.length);
  const length = lines.reduce(
    (sum, line, at) => sum + line.length + (scopes[at] as number),
    0,
  );
  return length > MAX_TRANSLATED ? null : lines;
}

/** Whether a translation is one of these notes, by notesKey(), into this language. */
export function translates(
  translation: Translation | undefined,
  of: string | null,
  language: Language,
): translation is Translation {
  return translation?.of === of && translation.language === language;
}

/**
 * The lines of the notes as the message shows them, in the language of the
 * pager: each heading from the catalog, and the items and texts translated when
 * the release has the translation of these notes, each behind its scope; in
 * English until then.
 */
export function shownNotes(
  notes: ReleaseNotes,
  translation: Translation | undefined,
  t: Texts,
): NoteLine[] {
  const words =
    translates(translation, notesKey(notes), t.language) &&
    translation.lines !== undefined
      ? translation.lines
      : [];
  let at = 0;
  return notes.lines.map((line) => {
    if ("heading" in line) {
      return { heading: heading(line.heading, t) };
    }
    const text = textOf(line);
    const own = words[at];
    at += 1;
    const shown = own === undefined ? text : `${split(text).scope}${own}`;
    return "item" in line ? { item: shown } : { text: shown };
  });
}
