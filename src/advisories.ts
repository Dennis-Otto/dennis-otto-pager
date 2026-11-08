/**
 * The reminder of a private vulnerability report: SECURITY.md promises to
 * acknowledge a report within 7 days, so on the day before, the schedule asks
 * GitHub once whether the report still waits in triage. If it does, its message
 * comes again, which notifies, with a note of the day; a report that was accepted
 * needs no reminder, and one that was closed, withdrawn or published on GitHub
 * shows that instead. Of the advisory the pager reads its state alone, never its
 * summary or its description, which are under embargo.
 */
import { describe } from "./context.ts";
import { SUBREQUESTS } from "./deliveries.ts";
import { type Context, show } from "./pager.ts";
import { ACKNOWLEDGE_DAYS, dayAfter } from "./render.ts";
import type { Advisory } from "./store.ts";

/**
 * The calls to the network that a reminder takes at most: a token of the app, the
 * state of the advisory, its new message, the delete of the old one and a rename
 * of its topic.
 */
export const REMINDER_CALLS = 5;

/** What GitHub says of the state of the report, or null when it doesn't answer the app. */
async function stateOf(
  context: Context,
  item: Advisory,
): Promise<string | null> {
  try {
    return (
      (await context.github.advisoryState(
        item.installation,
        item.repo,
        item.ghsa,
      )) ?? null
    );
  } catch (error) {
    // Such as an app without the permission to read advisories, or GitHub out of
    // reach: a reminder too many is better than a promise missed.
    console.warn(`The state of ${item.ghsa} of ${item.repo}:`, describe(error));
    return null;
  }
}

/** Remind of one report as its state on GitHub says; returns whether it got a new message. */
async function remind(context: Context, item: Advisory): Promise<boolean> {
  const state = await stateOf(context, item);
  delete item.remindAt;
  switch (state) {
    case "draft":
      // Accepted, which acknowledges it: the message stays as it is.
      await context.store.put(item);
      return false;
    case "published":
      item.state = "published";
      item.snoozedUntil = null;
      item.note = null;
      await show(context, item);
      return false;
    case "closed":
    case "withdrawn":
      item.state = "done";
      item.snoozedUntil = null;
      item.note = context.t("note.closedOnGitHub");
      await show(context, item);
      return false;
    default:
      item.snoozedUntil = null;
      item.note = context.t("note.advisoryDue", {
        date: context.t.date(dayAfter(item.reported, ACKNOWLEDGE_DAYS)),
      });
      await show(context, item, true);
      return true;
  }
}

/**
 * Remind of the reports whose day before the acknowledgement came, as far as the
 * calls of this run reach; the rest wait for the next run. Returns the ids of the
 * things that got a new message.
 */
export async function remindAdvisories(
  context: Context,
  due: string[],
): Promise<string[]> {
  const shown: string[] = [];
  for (const id of due) {
    if (context.subrequests() + REMINDER_CALLS > SUBREQUESTS) {
      break;
    }
    // The list may lag behind a write: only the record says whether it is due.
    const item = await context.store.get(id);
    if (
      item?.kind !== "advisory" ||
      item.state !== "open" ||
      item.remindAt === undefined ||
      item.remindAt > context.now()
    ) {
      continue;
    }
    if (await remind(context, item)) {
      shown.push(id);
    }
  }
  return shown;
}
