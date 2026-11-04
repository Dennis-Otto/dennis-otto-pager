/**
 * The schedule of the Worker, every 15 minutes: a thing that "Later" put aside
 * comes back as a new message when its time is up, a text of the maintainer whose
 * answer didn't come in time gets its 😢, and the reminder of the token of Claude
 * comes three weeks before it expires.
 */
import { type Context, show } from "./pager.ts";
import { itemId, keys } from "./store.ts";
import { REACTIONS } from "./telegram.ts";

const DAY = 24 * 60 * 60 * 1000;
/** How many days before the token of Claude expires the pager reminds. */
export const REMIND_DAYS = 21;

/**
 * How long a text of the maintainer waits for the answer of the control repository,
 * in milliseconds. Its jobs take 40 minutes at most (prepare 5, ask 30, answer 5),
 * and the rest is for the queue of GitHub Actions; with the schedule every 15
 * minutes, the 😢 comes between 60 and 75 minutes after the text.
 */
export const ANSWER_WITHIN = 60 * 60 * 1000;

/** Give up on the texts whose answer didn't come in time: their 👀 becomes 😢. */
async function giveUp(context: Context): Promise<void> {
  const late = await context.store.waiting(context.now() - ANSWER_WITHIN);
  if (late.length === 0) {
    return;
  }
  for (const message of late) {
    await context.telegram.react(message, REACTIONS.failed);
  }
  await context.store.settle(late);
}

async function bringBack(context: Context): Promise<string[]> {
  const done: string[] = [];
  for (const id of await context.store.due(context.now())) {
    const item = await context.store.get(id);
    if (item === null) {
      // Expired between the list and the read.
      continue;
    }
    item.snoozedUntil = null;
    await show(context, item, true);
    done.push(id);
  }
  return done;
}

async function remind(context: Context): Promise<string | null> {
  const expires = context.settings.tokenExpires;
  if (expires === null) {
    return null;
  }
  const left = Math.ceil(
    (Date.parse(`${expires}T00:00:00Z`) - context.now()) / DAY,
  );
  if (left > REMIND_DAYS) {
    return null;
  }
  const id = await itemId(keys.reminder(`claude-token:${expires}`));
  if ((await context.store.get(id)) !== null) {
    return null;
  }
  const repo = context.settings.controlRepository;
  const { t } = context;
  const date = t.date(expires);
  const text =
    left > 0
      ? t("reminder.soon", {
          repo,
          date,
          days:
            left === 1
              ? t("reminder.days.one")
              : t("reminder.days.many", { days: left }),
        })
      : t("reminder.expired", { repo, date });
  await show(context, {
    id,
    kind: "reminder",
    state: "open",
    repo,
    installation: 0,
    messageId: null,
    note: null,
    snoozedUntil: null,
    text,
  });
  return id;
}

/** One run of the schedule; returns the ids of the things that it showed. */
export async function runSchedule(context: Context): Promise<string[]> {
  const shown = await bringBack(context);
  await giveUp(context);
  const reminder = await remind(context);
  return reminder === null ? shown : [...shown, reminder];
}
