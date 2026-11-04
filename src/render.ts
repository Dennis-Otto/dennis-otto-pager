/**
 * The text of each message, in the HTML of Telegram. Every text that comes from
 * GitHub or from the control repository is escaped, and every link has to point to
 * GitHub, so a title can't add markup or a link of its own.
 */
import type { Entry, Item } from "./store.ts";

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

function entries(list: Entry[]): string {
  return list.map((entry) => `• ${link(entry.label, entry.url)}`).join("\n");
}

const STATES: Record<string, string> = {
  drafting: "✍️ The control repository drafts a reply…",
  sent: "✅ Sent.",
  ignored: "✖ Ignored.",
  fixing: "🛠 A fix is under way in the control repository…",
  recovered: "✅ Green again.",
  resolved: "✅ Resolved.",
  updating: "⏳ Updated: waiting for its checks again.",
  merging: "🔀 Merging…",
  merged: "🔀 Merged: the release is being published…",
  done: "✅ Done.",
};

function body(item: Item): string {
  switch (item.kind) {
    case "contribution": {
      const what = item.pull ? "pull request" : "issue";
      const head = `🙋 <b>New ${what}</b> in ${repoLink(item.repo)} by <b>${html(item.author, 100)}</b>\n${link(`#${item.number} ${item.title}`, item.url)}`;
      if (
        item.draft === null ||
        item.state === "sent" ||
        item.state === "ignored"
      ) {
        return head;
      }
      return `${head}\n\n<b>Draft of a reply</b>, which "Send" posts in your name as it stands here:\n<blockquote>${html(item.draft, 3500)}</blockquote>`;
    }
    case "alarm":
      return `🚨 <b>${html(item.repo)} needs you</b>\n${entries(item.entries)}`;
    case "alert":
      return `🛡 <b>Code scanning in ${html(item.repo)}</b>\n${entries(item.entries)}`;
    case "release": {
      const head = `📦 <b>Release ${html(item.version, 50)}</b> of ${repoLink(item.repo)}: ${link(`#${item.number}`, item.url)}`;
      if (item.state === "ready") {
        return `${head}\nEvery check is green, and "Merge" publishes it.`;
      }
      if (item.state === "published") {
        return `${head}\n✅ Published.`;
      }
      return head;
    }
    case "reminder":
      return `🔔 ${html(item.text, 1000)}`;
  }
}

/** The whole text of a thing's message: what it is, its state and its last note. */
export function render(item: Item, now: number): string {
  const lines = [body(item)];
  const state = STATES[item.state];
  if (state !== undefined) {
    lines.push(state);
  }
  if (item.note !== null) {
    lines.push(`<i>${html(item.note, 500)}</i>`);
  }
  if (item.snoozedUntil !== null && item.snoozedUntil > now) {
    const hours = Math.max(1, Math.round((item.snoozedUntil - now) / 3600000));
    lines.push(`⏰ Back in ${hours} h.`);
  }
  return lines.join("\n");
}
