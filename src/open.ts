/**
 * The answer to /open: what still waits for the maintainer, one line per thing that
 * offers a button, grouped by repository, each linked to its page on GitHub, with
 * when ⏰ Later brings it back. The topics of the chat keep done and ignored things
 * beside the open ones (decision 0005), so the list answers on demand what they
 * show only to a reader who tells ✅ from open by eye. It reads the records and
 * nothing else, acts on nothing and sends nothing to the control repository: an
 * answer to a question, not a message that all is well.
 */
import { allowed } from "./buttons.ts";
import type { Context } from "./pager.ts";
import { html, link, MAX_MESSAGE, securityPage, visible } from "./render.ts";
import { type Item, isClosed } from "./store.ts";
import { topicName } from "./topics.ts";

/** The page of a thing on GitHub, or null for one that has none, such as a reminder. */
function page(item: Item): string | null {
  switch (item.kind) {
    case "alarm":
      return `https://github.com/${item.repo}/actions`;
    case "alert":
      return securityPage(item.repo);
    case "reminder":
    case "decision":
      return null;
    default:
      return item.url;
  }
}

/** The line of a thing: its name as its topic says it, linked, and when Later brings it back. */
function line(context: Context, item: Item): string {
  const name = topicName(item, context.t);
  const url = page(item);
  const thing = url === null ? html(name) : link(name, url);
  const until = item.snoozedUntil;
  return until !== null && until > context.now()
    ? context.t("open.later", { thing, time: context.t.time(until) })
    : thing;
}

/** The things that still wait for the maintainer: open, and with a button. */
async function waiting(context: Context): Promise<Item[]> {
  const ids = await context.store.unclosed();
  const items = await Promise.all(ids.map((id) => context.store.get(id)));
  // The list may lag behind a write: only the record says whether it is open. A
  // thing that offers no button, such as a workflow whose rerun of After the
  // checks may still pass or a release that merges, waits for GitHub, not for him.
  return items
    .filter(
      (item): item is Item =>
        item !== null && !isClosed(item) && allowed(item).length > 0,
    )
    .sort(
      (a, b) =>
        a.repo.localeCompare(b.repo) ||
        topicName(a, context.t).localeCompare(topicName(b, context.t)),
    );
}

/** The last line of a list that has no room for the rest. */
function more(context: Context, count: number): string {
  return context.t("open.more", { count });
}

/**
 * The answer to /open, within the characters of one message: the things that don't
 * fit are counted in its last line.
 */
export async function open(context: Context): Promise<string> {
  const { t } = context;
  const items = await waiting(context);
  if (items.length === 0) {
    return t("open.none");
  }
  const lines = [t("open.title", { count: items.length })];
  let length = visible(lines[0] as string);
  let repo: string | null = null;
  for (const [index, item] of items.entries()) {
    const added: string[] = [];
    if (item.repo !== repo) {
      added.push(
        "",
        `<b>${link(item.repo, `https://github.com/${item.repo}`)}</b>`,
      );
    }
    added.push(line(context, item));
    // Each line costs its newline too, and while things follow, the line that
    // counts them must still fit after it.
    const cost = added.reduce((sum, each) => sum + 1 + visible(each), 0);
    const left = items.length - index - 1;
    const rest = left === 0 ? 0 : 2 + visible(more(context, left));
    if (length + cost + rest > MAX_MESSAGE) {
      lines.push("", more(context, left + 1));
      break;
    }
    lines.push(...added);
    length += cost;
    repo = item.repo;
  }
  return lines.join("\n");
}
