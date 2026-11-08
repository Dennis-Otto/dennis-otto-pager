/**
 * The part of the schedule for a workflow that fails on the default branch: the
 * failure of a first attempt waits, unseen, for the rerun that the bot of the
 * checks of the blueprint makes of the tests and of a release. Once WAIT of
 * src/pager.ts is over, the pager reads the run: a rerun that still runs gets
 * another WAIT, one that passed ends the thing unseen, and any other failure shows
 * now, as a new message, which notifies.
 */
import { SUBREQUESTS } from "./deliveries.ts";
import { GitHubError, type WorkflowRun } from "./github.ts";
import { type Context, show, WAIT } from "./pager.ts";
import type { Workflow } from "./store.ts";

/**
 * The most calls to the network that one workflow takes in the schedule: its run
 * and a token for it, and for its message a new topic with its check, the message
 * and their fallbacks, and the name of the topic.
 */
export const SETTLE = 8;

/** Whether the schedule has the calls left for one more workflow; the rest waits for its next run. */
export function canSettle(context: Context): boolean {
  return SUBREQUESTS - context.subrequests() >= SETTLE;
}

/**
 * A workflow whose failure waited for a rerun: returns whether it showed now. A
 * run that GitHub can't tell about shows as it failed.
 */
export async function settle(
  context: Context,
  item: Workflow,
): Promise<boolean> {
  let run: WorkflowRun | null = null;
  try {
    run = await context.github.workflowRun(
      item.installation,
      item.repo,
      item.run,
    );
  } catch (error) {
    if (!(error instanceof GitHubError)) {
      throw error;
    }
    console.error(
      "The run of a workflow that fails can't be read:",
      error.message,
    );
  }
  const attempt = run?.run_attempt;
  if (
    run !== null &&
    Number.isSafeInteger(attempt) &&
    (attempt as number) > item.attempt
  ) {
    if (run.status !== "completed") {
      item.snoozedUntil = context.now() + WAIT;
      await context.store.put(item);
      return false;
    }
    // A rerun that ended, whose event the pager didn't get.
    item.attempt = attempt as number;
    if (run.conclusion === "success") {
      item.state = "recovered";
      item.snoozedUntil = null;
      await context.store.put(item);
      return false;
    }
    item.url = run.html_url ?? item.url;
  }
  item.state = "failing";
  item.snoozedUntil = null;
  await show(context, item);
  return true;
}
