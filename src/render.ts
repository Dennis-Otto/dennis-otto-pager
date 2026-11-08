/**
 * The text of each message, in the HTML of Telegram and the language of the
 * settings. Every text that comes from GitHub or from the control repository is
 * escaped, and every link has to point to GitHub, so a title can't add markup or a
 * link of its own.
 */
import { cut, MAX_EXCERPT, type ReleaseNotes } from "./content.ts";
import {
  type Advisory,
  type Changed,
  type Contribution,
  type Decision,
  type Entry,
  type Item,
  isClosed,
  MAX_ANSWER,
  MAX_OPTION,
  MAX_QUESTION,
  type Pictures,
  type Release,
} from "./store.ts";
import type { Texts } from "./texts.ts";

/** A text escaped for the HTML of Telegram, and cut to at most max characters. */
export function html(text: string, max = 300): string {
  return cut(text, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A link to an address of GitHub, or the text alone for any other address. */
export function link(text: string, url: string): string {
  if (!url.startsWith("https://github.com/")) {
    return html(text);
  }
  return `<a href="${html(url, 2000)}">${html(text)}</a>`;
}

function repoLink(repo: string): string {
  return link(repo, `https://github.com/${repo}`);
}

/** The most characters of a message, as Telegram counts them once it read the HTML. */
export const MAX_MESSAGE = 4096;

/** The most characters of the note below a message. */
const MAX_NOTE = 500;

/** The fewest characters of the start of a text that are worth a quote; with less room, the message shows none. */
const MIN_EXCERPT = 100;

/** The entities that html() writes, each of which Telegram counts as one character. */
const ENTITIES = ["&amp;", "&lt;", "&gt;", "&quot;"];

/**
 * How many characters Telegram counts in a text of its HTML: a tag counts none, and
 * an entity one, since html() leaves no other < or & in a text. It only counts, in
 * one pass, so that no text can make it slow.
 */
export function visible(text: string): number {
  let count = 0;
  let tag = false;
  for (let at = 0; at < text.length; at += 1) {
    const character = text[at];
    if (tag || character === "<") {
      tag = character !== ">";
      continue;
    }
    if (character === "&") {
      const entity = ENTITIES.find((each) => text.startsWith(each, at));
      at += (entity?.length ?? 1) - 1;
    }
    count += 1;
  }
  return count;
}

/** The most entries that a bundle lists, and the most characters they take. */
export const MAX_ENTRIES = 20;
const MAX_ENTRIES_LENGTH = 3000;

/**
 * The entries of a bundle, as many as fit: Telegram takes 4096 characters at most,
 * and a message that is too long would fail every later change of the bundle. The
 * rest is a line with a link to where GitHub lists them all.
 */
function entries(list: Entry[], all: string, t: Texts): string {
  const lines: string[] = [];
  let length = 0;
  for (const entry of list) {
    const rerun = entry.rerun === true ? ` — ${t("message.rerunning")}` : "";
    const line = `• ${link(entry.label, entry.url)}${rerun}`;
    if (
      lines.length === MAX_ENTRIES ||
      length + line.length > MAX_ENTRIES_LENGTH
    ) {
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  const more = list.length - lines.length;
  if (more > 0) {
    lines.push(link(t("message.more", { count: more }), all));
  }
  return lines.join("\n");
}

/** How a picture changed, in words. */
function how(picture: Changed, t: Texts): string {
  switch (picture.status) {
    case "new":
      return t("picture.new");
    case "deleted":
      return t("picture.deleted");
    default:
      return picture.share === null
        ? t("picture.resized")
        : t("picture.changed", { share: t.percent(picture.share) });
  }
}

/** What the text of the pictures of a pull request shows, for its own thing or a release. */
export type PicturesView = Pick<
  Pictures,
  | "repo"
  | "number"
  | "title"
  | "url"
  | "sha"
  | "changed"
  | "count"
  | "shown"
  | "check"
>;

/**
 * The pictures of a pull request that look different at a head: each with how it
 * changed, as many as the message lists, whether the album below shows them, and a
 * link to the run of the check, whose artifacts have them all before and after.
 */
export function picturesText(view: PicturesView, t: Texts): string {
  const values = {
    repo: repoLink(view.repo),
    sha: `<code>${html(view.sha.slice(0, 7))}</code>`,
    link: link(`#${view.number} ${view.title}`, view.url),
  };
  if (view.count === 0) {
    return t("message.picturesSame", values);
  }
  const lines = [
    view.count === 1
      ? t("message.pictures.one", values)
      : t("message.pictures.many", { ...values, count: view.count }),
    ...view.changed.map(
      (picture) =>
        `• <code>${html(picture.path, 100)}</code>: ${how(picture, t)}`,
    ),
  ];
  if (view.count > view.changed.length) {
    lines.push(t("message.more", { count: view.count - view.changed.length }));
  }
  lines.push(
    view.shown > 0
      ? t("message.album", { shown: view.shown, count: view.count })
      : t("message.noAlbum"),
    link(t("message.check"), view.check),
  );
  return lines.join("\n");
}

/** The states that a message names below what it shows. */
const STATES = [
  "drafting",
  "sent",
  "ignored",
  "fixing",
  "recovered",
  "resolved",
  "updating",
  "merging",
  "merged",
  "done",
] as const;

type Named = (typeof STATES)[number];

function named(state: Item["state"]): state is Named {
  return (STATES as readonly string[]).includes(state);
}

/** What a contribution is: an issue, a pull request, a discussion or a comment on one. */
function contributionHead(
  item: Contribution,
):
  | "message.issue"
  | "message.pull"
  | "message.discussion"
  | "message.comment"
  | "message.issueComment"
  | "message.pullComment" {
  if (item.discussion !== undefined) {
    return item.discussion.comment === undefined
      ? "message.discussion"
      : "message.comment";
  }
  if (item.comment !== undefined) {
    return item.pull ? "message.pullComment" : "message.issueComment";
  }
  return item.pull ? "message.pull" : "message.issue";
}

/**
 * The start of what a contribution says, as a quote that Telegram shows folded,
 * in at most room characters, or null when it says nothing or no room is left.
 */
function quote(item: Contribution, room: number): string | null {
  const max = Math.min(MAX_EXCERPT, room);
  if (item.excerpt === undefined || max < MIN_EXCERPT) {
    return null;
  }
  return `<blockquote expandable>${html(item.excerpt, max)}</blockquote>`;
}

/**
 * A line of the notes of a release, escaped, with each number of a pull request
 * or an issue, such as #56, linked to it in the repository of the release.
 */
function linked(text: string, repo: string): string {
  return html(text).replace(
    /(^|[\s(])#(\d{1,7})\b/g,
    (_, before: string, number: string) =>
      `${before}${link(`#${number}`, `https://github.com/${repo}/issues/${number}`)}`,
  );
}

/**
 * The notes of a release: each heading in bold, each item after a bullet, and a
 * link to the pull request for those that the message leaves out; null when the
 * notes have no line.
 */
function notesText(
  item: Release,
  notes: ReleaseNotes,
  t: Texts,
): string | null {
  const lines = notes.lines.map((line) => {
    if ("heading" in line) {
      return `<b>${html(line.heading)}</b>`;
    }
    return "item" in line
      ? `• ${linked(line.item, item.repo)}`
      : linked(line.text, item.repo);
  });
  if (notes.more > 0) {
    lines.push(link(t("message.more", { count: notes.more }), item.url));
  }
  return lines.length === 0 ? null : lines.join("\n");
}

/** A release: its version, its breaking changes, its notes and what "Merge" does. */
function releaseText(item: Release, t: Texts): string {
  const head = [
    t("message.release", {
      version: html(item.version, 50),
      repo: repoLink(item.repo),
      link: link(`#${item.number}`, item.url),
    }),
  ];
  if (item.notes?.breaking === true) {
    head.push(t("message.breaking"));
  }
  const notes =
    item.notes === undefined ? null : notesText(item, item.notes, t);
  const end =
    item.state === "ready"
      ? t("message.ready")
      : item.state === "published"
        ? t("message.published")
        : null;
  return [head.join("\n"), notes, end]
    .filter((part) => part !== null)
    .join(notes === null ? "\n" : "\n\n");
}

/** The page of GitHub that lists every alert of code scanning and secret scanning of a repository. */
export function securityPage(repo: string): string {
  return `https://github.com/${repo}/security`;
}

const DAY = 24 * 60 * 60 * 1000;

/** The days within which SECURITY.md promises to acknowledge a vulnerability report. */
export const ACKNOWLEDGE_DAYS = 7;
/** The days within which SECURITY.md promises to assess a vulnerability report. */
export const ASSESS_DAYS = 14;

/** The day that lies a number of days after a time, such as 2026-11-15. */
export function dayAfter(time: number, days: number): string {
  return new Date(time + days * DAY).toISOString().slice(0, 10);
}

/**
 * A private vulnerability report: its repository, its id with its link, its
 * severity and, while it is open, the days that SECURITY.md promises. What it says
 * is under embargo, so the message never shows it, and the pager doesn't keep it.
 */
function advisoryText(item: Advisory, t: Texts): string {
  const head = t("message.advisory", {
    repo: repoLink(item.repo),
    link: link(item.ghsa, item.url),
    severity: t(`severity.${item.severity ?? "none"}`),
  });
  if (item.state === "published") {
    return `${head}\n${t("message.published")}`;
  }
  if (item.state !== "open") {
    return head;
  }
  const due = t("message.advisoryDue", {
    acknowledge: t.date(dayAfter(item.reported, ACKNOWLEDGE_DAYS)),
    assess: t.date(dayAfter(item.reported, ASSESS_DAYS)),
  });
  return `${head}\n${due}`;
}

/**
 * What a thing is. A contribution quotes the start of what it says in the room
 * that the rest of its message leaves, so that the whole stays within MAX_MESSAGE.
 */
function body(item: Item, t: Texts, room: number): string {
  switch (item.kind) {
    case "contribution": {
      const head = t(contributionHead(item), {
        repo: repoLink(item.repo),
        author: html(item.author, 100),
        link: link(`#${item.number} ${item.title}`, item.url),
      });
      const said = quote(item, room - 1);
      const top = said === null ? head : `${head}\n${said}`;
      // A closed thing shows no draft: it went, it was ignored, or GitHub dealt with it.
      if (item.draft === null || isClosed(item)) {
        return top;
      }
      // The reply in a discussion goes as the app, any other in the maintainer's name.
      const draft =
        item.discussion === undefined ? "message.draft" : "message.reply";
      return `${top}\n\n${t(draft, { draft: html(item.draft, 3500) })}`;
    }
    case "alarm":
      return t("message.alarm", {
        repo: html(item.repo),
        entries: entries(
          item.entries,
          `https://github.com/${item.repo}/actions`,
          t,
        ),
      });
    case "alert":
      return t("message.alert", {
        repo: html(item.repo),
        entries: entries(item.entries, securityPage(item.repo), t),
      });
    case "advisory":
      return advisoryText(item, t);
    case "release":
      return releaseText(item, t);
    case "pictures":
      return picturesText(item, t);
    case "reminder":
      return `🔔 ${html(item.text, 1000)}`;
    case "decision":
      return decisionText(item, t);
  }
}

/**
 * How a question of an agent ended: the option that the maintainer chose, his own
 * words, or that the agent took it back; null while it is open.
 */
function decisionEnd(item: Decision, t: Texts): string | null {
  if (item.state === "withdrawn") {
    return t("message.withdrawn");
  }
  if (item.ownAnswer !== undefined) {
    return t("message.ownAnswer", {
      answer: html(item.ownAnswer, MAX_ANSWER),
    });
  }
  const chosen = item.choice === null ? undefined : item.options[item.choice];
  return chosen === undefined
    ? null
    : t("message.chosen", { option: html(chosen, MAX_OPTION) });
}

/** A question of an agent, and how it ended, once it did. */
function decisionText(item: Decision, t: Texts): string {
  const head = t("message.decision", {
    question: html(item.question, MAX_QUESTION),
  });
  const end = decisionEnd(item, t);
  return end === null ? head : `${head}\n\n${end}`;
}

/**
 * The whole text of a thing's message: what it is, its state, its last note and
 * when "Later" brings it back. Telegram refuses a message longer than MAX_MESSAGE,
 * and with it every later change of the message, so the note takes the room that
 * the rest leaves, and the start of what a contribution says the room after that.
 */
export function render(item: Item, now: number, t: Texts): string {
  const state = named(item.state) ? t(`state.${item.state}`) : null;
  let back: string | null = null;
  if (item.snoozedUntil !== null && item.snoozedUntil > now) {
    const hours = Math.max(1, Math.round((item.snoozedUntil - now) / 3600000));
    back = t("message.back", { hours });
  }
  const compose = (room: number, note: string | null) =>
    [body(item, t, room), state, note, back]
      .filter((line) => line !== null)
      .join("\n");
  let room = MAX_MESSAGE - visible(compose(0, null));
  let note: string | null = null;
  if (item.note !== null) {
    note = `<i>${html(item.note, Math.min(MAX_NOTE, room - 1))}</i>`;
    room -= visible(note) + 1;
  }
  return compose(room, note);
}
