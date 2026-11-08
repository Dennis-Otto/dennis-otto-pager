/**
 * The text of each message, in the HTML of Telegram and the language of the
 * settings. Every text that comes from GitHub or from the control repository is
 * escaped, and every link has to point to GitHub, so a title can't add markup or a
 * link of its own.
 */
import {
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
} from "./store.ts";
import type { Texts } from "./texts.ts";

/** A text escaped for the HTML of Telegram, and cut to at most max characters. */
export function html(text: string, max = 300): string {
  const cut = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return cut
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
): "message.issue" | "message.pull" | "message.discussion" | "message.comment" {
  if (item.discussion !== undefined) {
    return item.discussion.comment === undefined
      ? "message.discussion"
      : "message.comment";
  }
  return item.pull ? "message.pull" : "message.issue";
}

function body(item: Item, t: Texts): string {
  switch (item.kind) {
    case "contribution": {
      const head = t(contributionHead(item), {
        repo: repoLink(item.repo),
        author: html(item.author, 100),
        link: link(`#${item.number} ${item.title}`, item.url),
      });
      // A closed thing shows no draft: it went, it was ignored, or GitHub dealt with it.
      if (item.draft === null || isClosed(item)) {
        return head;
      }
      // The reply in a discussion goes as the app, any other in the maintainer's name.
      const draft =
        item.discussion === undefined ? "message.draft" : "message.reply";
      return `${head}\n\n${t(draft, { draft: html(item.draft, 3500) })}`;
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
        entries: entries(
          item.entries,
          `https://github.com/${item.repo}/security/code-scanning`,
          t,
        ),
      });
    case "release": {
      const head = t("message.release", {
        version: html(item.version, 50),
        repo: repoLink(item.repo),
        link: link(`#${item.number}`, item.url),
      });
      if (item.state === "ready") {
        return `${head}\n${t("message.ready")}`;
      }
      if (item.state === "published") {
        return `${head}\n${t("message.published")}`;
      }
      return head;
    }
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

/** The whole text of a thing's message: what it is, its state and its last note. */
export function render(item: Item, now: number, t: Texts): string {
  const lines = [body(item, t)];
  if (named(item.state)) {
    lines.push(t(`state.${item.state}`));
  }
  if (item.note !== null) {
    lines.push(`<i>${html(item.note, 500)}</i>`);
  }
  if (item.snoozedUntil !== null && item.snoozedUntil > now) {
    const hours = Math.max(1, Math.round((item.snoozedUntil - now) / 3600000));
    lines.push(t("message.back", { hours }));
  }
  return lines.join("\n");
}
