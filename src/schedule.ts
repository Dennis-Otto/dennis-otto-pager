/**
 * The schedule of the Worker, every 15 minutes: a thing that "Later" put aside
 * comes back as a new message when its time is up, a thing whose job of the
 * control repository didn't answer in time gets its buttons back, a text of the
 * maintainer whose answer didn't come in time gets its 😢, a vulnerability report
 * that still waits in triage on the day before its acknowledgement is due comes
 * again (src/advisories.ts), the reminder of each token of the maintainer comes
 * three weeks before it expires (src/tokens.ts), a workflow that failed on the
 * default branch and whose rerun didn't help shows (src/workflows.ts), a topic
 * whose rename Telegram refused gets its name (src/topics.ts), and an
 * event of GitHub that the pager failed to handle comes again
 * (src/deliveries.ts).
 *
 * Each step, and each thing of a step, goes apart from the others: one that
 * Telegram or GitHub refuses, or that a network that breaks stops, goes to the
 * log and costs only itself, and the run goes on with the next thing and the next
 * step, above all the events that failed, which get their attempts only for three
 * hours. A thing that failed is due again in the next run. A run where nothing
 * failed comes to its end and says so in the storage of the Durable Object; one
 * where something failed notes there what failed last instead. Both are for the
 * check of the pager's health (src/health.ts).
 */
import { remindAdvisories } from "./advisories.ts";
import { canShow, failedEvents, SUBREQUESTS } from "./deliveries.ts";
import { errorOf, FAILED, type Failure, RAN } from "./health.ts";
import { type Context, show } from "./pager.ts";
import { beforeJob, type Item } from "./store.ts";
import { REACTIONS } from "./telegram.ts";
import { refreshReminder, remindTokens } from "./tokens.ts";
import { retitle } from "./topics.ts";
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

/** How long the schedule tries again to rename a topic that Telegram refused to rename. */
export const RENAME_FOR = DAY;

/** The most topics that one run of the schedule tries to rename, each one call to Telegram. */
export const MAX_RENAMES = 5;

/**
 * Do one thing of a step of the schedule apart from the others, such as the
 * reminder of one token: an error of it goes to the log and is noted, and the
 * step goes on with its next thing. Returns whether the thing went through.
 */
export type Apart = (
  thing: string,
  work: () => Promise<void>,
) => Promise<boolean>;

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

/**
 * Bring back the things whose time is up, as far as the calls of this run reach:
 * the rest waits for the next run.
 */
async function bringBack(
  context: Context,
  due: string[],
  apart: Apart,
): Promise<string[]> {
  const done: string[] = [];
  for (const id of due) {
    // A workflow takes no more calls than any other thing.
    if (!canShow(context)) {
      break;
    }
    await apart(`thing ${id}`, async () => {
      const item = await context.store.get(id);
      if (item === null) {
        // Expired between the list and the read.
        return;
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
        return;
      }
      item.snoozedUntil = null;
      if (item.kind === "reminder" && !(await refreshReminder(context, item))) {
        // Its token was renewed or removed while it was put aside: the reminder of
        // the old day is over, and its message loses its buttons without a page.
        item.state = "done";
        await show(context, item);
        return;
      }
      await show(context, item, true);
      done.push(id);
    });
  }
  return done;
}

/**
 * Give a thing whose job of the control repository didn't answer within the hour
 * its buttons back, once, as a job that failed does: a new message, which
 * notifies, in the state before its button, with a note that no answer came. An
 * answer that comes later still shows, as a draft or a note. The things that the
 * calls of this run don't reach wait for the next run.
 */
async function noAnswer(
  context: Context,
  waiting: string[],
  apart: Apart,
): Promise<string[]> {
  const done: string[] = [];
  for (const id of waiting) {
    if (!canShow(context)) {
      break;
    }
    await apart(`thing ${id}`, async () => {
      // The list may lag behind a write: only the record says whether it still waits.
      const item = await context.store.get(id);
      const before = item === null ? undefined : beforeJob(item);
      if (
        item === null ||
        before === undefined ||
        (item.jobStarted ?? context.now()) > context.now() - ANSWER_WITHIN
      ) {
        return;
      }
      (item as { state: Item["state"] }).state = before;
      delete item.jobStarted;
      item.note = context.t("note.noAnswer");
      await show(context, item, true);
      done.push(id);
    });
  }
  return done;
}

/**
 * Rename the topics that Telegram refused to rename, such as after a burst of
 * calls, at most MAX_RENAMES per run and only while the run has calls to the
 * network left, so that the rest waits for the next run: a thing whose rename went through, or that
 * needs none any more, is kept without its mark, and one that Telegram still
 * refuses stays as it is, without a write, until RENAME_FOR is over, when it keeps
 * the old name and the log says so.
 */
async function renameAgain(
  context: Context,
  refused: string[],
  apart: Apart,
): Promise<string[]> {
  const renamed: string[] = [];
  for (const id of refused.slice(0, MAX_RENAMES)) {
    if (context.subrequests() >= SUBREQUESTS) {
      break;
    }
    await apart(`thing ${id}`, async () => {
      // The list may lag behind a write: only the record says whether it still waits.
      const item = await context.store.get(id);
      const since = item?.renameRefused;
      if (item === null || since === undefined) {
        return;
      }
      if (since <= context.now() - RENAME_FOR) {
        console.warn(
          `Telegram refused to rename topic ${item.topic?.thread} for a day; it keeps its name`,
        );
        delete item.renameRefused;
      } else {
        await retitle(context, item);
        if (item.renameRefused !== undefined) {
          return;
        }
        renamed.push(id);
      }
      await context.store.put(item);
    });
  }
  return renamed;
}

/**
 * One run of the schedule; returns the ids of the things that it showed. The
 * events that failed come last: they take the calls to the network that the steps
 * before them left, and the requests of the events that GitHub delivers again wait
 * only for the little that the run does after it asked for them. Each step runs
 * whatever the steps before it did, and only a run where nothing failed notes its
 * time.
 */
export async function runSchedule(context: Context): Promise<string[]> {
  const pending = await context.store.pending(
    context.now(),
    context.now() - ANSWER_WITHIN,
  );
  let failed = false;
  const apart: Apart = async (what, work) => {
    try {
      await work();
      return true;
    } catch (error) {
      failed = true;
      const said = errorOf(error);
      console.error(`The schedule failed at ${what}:`, said);
      await context.local.put<Failure>(FAILED, {
        at: new Date(context.now()).toISOString(),
        what,
        error: said,
      });
      return false;
    }
  };
  const shown: string[] = [];
  // One step, apart from the others, whose things go apart from each other too.
  const step = (name: string, work: (each: Apart) => Promise<string[]>) =>
    apart(name, async () => {
      shown.push(
        ...(await work((thing, one) => apart(`${name}, ${thing}`, one))),
      );
    });
  await step("the things that come back", (each) =>
    bringBack(context, pending.due, each),
  );
  await step("the things whose job didn't answer", (each) =>
    noAnswer(context, pending.waiting, each),
  );
  await step("the texts without an answer", async () => {
    await giveUp(context);
    return [];
  });
  // A report that came back from "Later" in this run is reminded of in the next.
  await step("the reminders of vulnerability reports", (each) =>
    remindAdvisories(
      context,
      pending.remind.filter((id) => !shown.includes(id)),
      each,
    ),
  );
  await step("the reminders of the tokens", (each) =>
    remindTokens(context, each),
  );
  await step("the renames of topics", (each) =>
    renameAgain(context, pending.rename, each),
  );
  await step("the events that failed", () => failedEvents(context));
  if (!failed) {
    await context.local.put(RAN, context.now());
  }
  return shown;
}
