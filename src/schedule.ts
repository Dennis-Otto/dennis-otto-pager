/**
 * The schedule of the Worker, every 15 minutes: a thing that "Later" put aside
 * comes back as a new message when its time is up, a thing whose job of the
 * control repository didn't answer in time gets its buttons back, a text of the
 * maintainer whose answer didn't come in time gets its 😢, the reminder of the
 * token of Claude comes three weeks before it expires, and an event of GitHub that
 * the pager failed to handle comes again (src/deliveries.ts).
 */
import { failedEvents } from "./deliveries.ts";
import { type Context, show } from "./pager.ts";
import { beforeJob, type Item, itemId, keys } from "./store.ts";
import { REACTIONS } from "./telegram.ts";

const DAY = 24 * 60 * 60 * 1000;
/** How many days before the token of Claude expires the pager reminds. */
export const REMIND_DAYS = 21;

/**
 * How long a text of the maintainer, and a thing whose button started a job, wait
 * for the answer of the control repository, in milliseconds. Its jobs take 40
 * minutes at most (prepare 5, ask 30, answer 5), and the rest is for the queue of
 * GitHub Actions; with the schedule every 15 minutes, the 😢 and the buttons come
 * back between 60 and 75 minutes after the text or the press.
 */
export const ANSWER_WITHIN = 60 * 60 * 1000;

/**
 * How long the pager keeps the thread of a text that it gave up on, in milliseconds,
 * so that an answer that comes late still goes into it.
 */
export const KEEP_LATE = DAY;

/**
 * Give up on the texts whose answer didn't come in time: their 👀 becomes 😢, and
 * their thread stays for a day, for an answer that comes late.
 */
async function giveUp(context: Context): Promise<void> {
  const late = await context.store.waiting(context.now() - ANSWER_WITHIN);
  for (const message of late) {
    await context.telegram.react(message, REACTIONS.failed);
  }
  await context.store.giveUp(late, context.now() - KEEP_LATE);
}

async function bringBack(context: Context, due: string[]): Promise<string[]> {
  const done: string[] = [];
  for (const id of due) {
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

/**
 * Give a thing whose job of the control repository didn't answer within the hour
 * its buttons back, once, as a job that failed does: a new message, which
 * notifies, in the state before its button, with a note that no answer came. An
 * answer that comes later still shows, as a draft or a note.
 */
async function noAnswer(
  context: Context,
  waiting: string[],
): Promise<string[]> {
  const done: string[] = [];
  for (const id of waiting) {
    // The list may lag behind a write: only the record says whether it still waits.
    const item = await context.store.get(id);
    const before = item === null ? undefined : beforeJob(item);
    if (
      item === null ||
      before === undefined ||
      (item.jobStarted ?? context.now()) > context.now() - ANSWER_WITHIN
    ) {
      continue;
    }
    (item as { state: Item["state"] }).state = before;
    delete item.jobStarted;
    item.note = context.t("note.noAnswer");
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

/**
 * One run of the schedule; returns the ids of the things that it showed. The
 * events that failed come last: they take the calls to the network that the steps
 * before them left, and the requests of the events that GitHub delivers again wait
 * only for the little that the run does after it asked for them.
 */
export async function runSchedule(context: Context): Promise<string[]> {
  const pending = await context.store.pending(
    context.now(),
    context.now() - ANSWER_WITHIN,
  );
  const shown = [
    ...(await bringBack(context, pending.due)),
    ...(await noAnswer(context, pending.waiting)),
  ];
  await giveUp(context);
  const reminder = await remind(context);
  if (reminder !== null) {
    shown.push(reminder);
  }
  return [...shown, ...(await failedEvents(context))];
}
