/**
 * The schedule of the Worker, every 15 minutes: a thing that "Later" put aside
 * comes back as a new message when its time is up, a thing whose job of the
 * control repository didn't answer in time gets its buttons back, a text of the
 * maintainer whose answer didn't come in time gets its 😢, a vulnerability report
 * that still waits in triage on the day before its acknowledgement is due comes
 * again (src/advisories.ts), the reminder of each token of the maintainer comes
 * three weeks before it expires (src/tokens.ts), a workflow that failed on the
 * default branch and whose rerun didn't help shows (src/workflows.ts), and an
 * event of GitHub that the pager failed to handle comes again
 * (src/deliveries.ts). A run that comes to its end says so in the storage of the
 * Durable Object, for the check of the pager's health (src/health.ts).
 */
import { remindAdvisories } from "./advisories.ts";
import { failedEvents } from "./deliveries.ts";
import { RAN } from "./health.ts";
import { type Context, show } from "./pager.ts";
import { beforeJob, type Item } from "./store.ts";
import { REACTIONS } from "./telegram.ts";
import { remindTokens } from "./tokens.ts";
import { canSettle, settle } from "./workflows.ts";

const DAY = 24 * 60 * 60 * 1000;

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
    if (item.kind === "workflow") {
      // A failure that waited for its rerun, unless an event showed or ended it
      // since the list; one that no calls are left for waits for the next run.
      if (
        item.state === "waiting" &&
        canSettle(context) &&
        (await settle(context, item))
      ) {
        done.push(id);
      }
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

/**
 * One run of the schedule; returns the ids of the things that it showed. The
 * events that failed come last: they take the calls to the network that the steps
 * before them left, and the requests of the events that GitHub delivers again wait
 * only for the little that the run does after it asked for them. Only a run that
 * came to its end notes its time.
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
  // A report that came back from "Later" in this run is reminded of in the next.
  shown.push(
    ...(await remindAdvisories(
      context,
      pending.remind.filter((id) => !shown.includes(id)),
    )),
  );
  shown.push(...(await remindTokens(context)));
  shown.push(...(await failedEvents(context)));
  await context.local.put(RAN, context.now());
  return shown;
}
