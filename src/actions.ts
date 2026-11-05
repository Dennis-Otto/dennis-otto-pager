/**
 * What each button does, from the allowlist of buttons.ts and nothing else. An
 * action checks again what it acts on, such as the head of a release pull request,
 * and writes only through the few calls of github.ts.
 */
import { allowed, headTag, type Press } from "./buttons.ts";
import { GitHubError, NoUserToken } from "./github.ts";
import { type Context, show } from "./pager.ts";
import { PASSED, releaseBlocker } from "./rules.ts";
import type {
  Alarm,
  Alert,
  Contribution,
  Item,
  Release,
  Reminder,
} from "./store.ts";

export interface Reply {
  text: string;
  alert: boolean;
}

const done = (text: string): Reply => ({ text, alert: false });
const refused = (text: string): Reply => ({ text, alert: true });

/** Send a thing to the workflow of the control repository, as an event of its own. */
async function toControl(
  context: Context,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<Reply | null> {
  const repo = context.settings.controlRepository;
  const installation = await context.github.installation(repo);
  if (installation === null) {
    return refused(context.t("answer.notInstalled", { repo }));
  }
  // The answers of the control repository to the maintainer come in their language.
  await context.github.dispatch(installation, repo, eventType, {
    ...payload,
    language: context.t.language,
  });
  return null;
}

async function merge(
  context: Context,
  item: Release,
  head: number | null,
): Promise<Reply> {
  // A button of another head, such as the Confirm of a proposal for 1.2.3 after the
  // release moved on to 1.3.0 under the same id, never merges what it didn't show.
  if (head !== null && head !== headTag(item.sha)) {
    return refused(context.t("answer.releaseMoved"));
  }
  const pull = await context.github.pullRequest(
    item.installation,
    item.repo,
    item.number,
  );
  if (pull.head?.sha !== item.sha) {
    item.state = "updating";
    item.sha = pull.head?.sha ?? "";
    await show(context, item);
    return refused(context.t("answer.releaseChanged"));
  }
  const blocker = releaseBlocker(
    pull,
    pull.base?.repo?.default_branch ?? "main",
  );
  if (blocker !== null) {
    return refused(
      context.t("answer.notMerged", { why: context.t.phrase(blocker) }),
    );
  }
  await context.github.merge(
    item.installation,
    item.repo,
    item.number,
    item.sha,
  );
  item.state = "merging";
  await show(context, item);
  return done(context.t("answer.merging"));
}

async function fix(context: Context, item: Alarm | Alert): Promise<Reply> {
  const failed = await toControl(context, "pager-fix", {
    item: item.id,
    repo: item.repo,
    kind: item.kind,
    entries: item.entries.map(({ label, url }) => ({ label, url })),
  });
  if (failed !== null) {
    return failed;
  }
  item.state = "fixing";
  item.jobStarted = context.now();
  await show(context, item);
  return done(context.t("answer.fixing"));
}

/**
 * Run the failed jobs of each run that the entries name again, as GitHub's "Re-run
 * failed jobs" does, after a look at the run: one that still runs, or whose newer
 * attempt runs, and one that passed on a retry stay as they are. The entries of a
 * run that runs again say so, until it fails or passes; a pass closes the issue of
 * the bot-health bot or the failure of the release, which takes the entry out.
 */
async function rerun(context: Context, item: Alarm): Promise<Reply> {
  const runs = new Set(
    item.entries.flatMap((entry) =>
      entry.run === undefined ? [] : [entry.run],
    ),
  );
  const started = new Set<number>();
  let running = false;
  try {
    for (const id of runs) {
      const run = await context.github.workflowRun(
        item.installation,
        item.repo,
        id,
      );
      if (run.status !== "completed") {
        running = true;
      } else if (!PASSED.has(run.conclusion ?? "")) {
        await context.github.rerunFailedJobs(item.installation, item.repo, id);
        started.add(id);
      }
    }
  } finally {
    // A run that GitHub started again shows it, also when the next one failed.
    if (started.size > 0) {
      for (const entry of item.entries) {
        if (entry.run !== undefined && started.has(entry.run)) {
          entry.rerun = true;
        }
      }
      await show(context, item);
    }
  }
  if (started.size > 0) {
    return done(context.t("answer.rerun"));
  }
  return refused(
    context.t(running ? "answer.rerunRunning" : "answer.rerunPassed"),
  );
}

async function draft(context: Context, item: Contribution): Promise<Reply> {
  const failed = await toControl(context, "pager-draft", {
    item: item.id,
    repo: item.repo,
    number: item.number,
    pull: item.pull,
  });
  if (failed !== null) {
    return failed;
  }
  item.state = "drafting";
  item.jobStarted = context.now();
  await show(context, item);
  return done(context.t("answer.drafting"));
}

async function assistant(context: Context, item: Contribution): Promise<Reply> {
  try {
    await context.github.issueAssistant(item.repo, item.number);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      return refused(context.t("answer.noOverride", { repo: item.repo }));
    }
    throw error;
  }
  item.note = context.t("note.assistant");
  await show(context, item);
  return done(context.t("answer.assistant"));
}

async function send(
  context: Context,
  item: Contribution,
  version: number | null,
): Promise<Reply> {
  if (version !== item.draftVersion || item.draft === null) {
    return refused(context.t("answer.draftOutdated"));
  }
  await context.github.comment(item.repo, item.number, item.draft);
  item.state = "sent";
  item.note = context.t("note.sent");
  await show(context, item);
  return done(context.t("answer.sent"));
}

async function edit(context: Context, item: Contribution): Promise<Reply> {
  // The prompt goes into the topic of the draft, or answers its message.
  const prompt = await context.telegram.prompt(
    context.t("edit.prompt", { thing: `${item.repo}#${item.number}` }),
    context.t("edit.placeholder"),
    item.topic?.thread ?? null,
    item.messageId,
  );
  await context.store.setPendingEdit({ item: item.id, prompt });
  return done(context.t("answer.edit"));
}

/** Run the action of a pressed button on its thing, if the thing still offers it. */
export async function press(
  context: Context,
  item: Item,
  pressed: Press,
): Promise<Reply> {
  if (!allowed(item).includes(pressed.action)) {
    return refused(context.t("answer.outdated"));
  }
  try {
    switch (pressed.action) {
      case "later": {
        const hours = context.settings.laterHours;
        item.snoozedUntil = context.now() + hours * 3600000;
        await show(context, item);
        return done(context.t("answer.later", { hours }));
      }
      case "ignore":
        (item as Exclude<Item, Reminder>).state = "ignored";
        item.snoozedUntil = null;
        await show(context, item);
        return done(context.t("answer.ignored"));
      case "done":
        (item as Reminder).state = "done";
        item.snoozedUntil = null;
        await show(context, item);
        return done(context.t("answer.done"));
      case "merge":
        return await merge(context, item as Release, pressed.version);
      case "fix":
        return await fix(context, item as Alarm | Alert);
      case "rerun":
        return await rerun(context, item as Alarm);
      case "draft":
        return await draft(context, item as Contribution);
      case "assistant":
        return await assistant(context, item as Contribution);
      case "send":
        return await send(context, item as Contribution, pressed.version);
      case "edit":
        return await edit(context, item as Contribution);
    }
  } catch (error) {
    if (error instanceof NoUserToken) {
      return refused(context.t("answer.noUserToken"));
    }
    if (error instanceof GitHubError) {
      return refused(context.t("answer.refused", { detail: error.detail }));
    }
    throw error;
  }
}
