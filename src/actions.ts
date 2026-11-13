/**
 * What each button does, from the allowlist of buttons.ts and nothing else. An
 * action checks again what it acts on, such as the head of a release pull request,
 * and writes only through the few calls of github.ts.
 */
import { allowed, headTag, type Press } from "./buttons.ts";
import { cut } from "./content.ts";
import { describe } from "./context.ts";
import {
  GitHubError,
  NoAnswer,
  NoUserToken,
  UserTokenRefused,
} from "./github.ts";
import { askForDraft, type Context, show, toControl } from "./pager.ts";
import { PASSED, releaseBlocker } from "./rules.ts";
import {
  type Alarm,
  type Alert,
  type Contribution,
  type Decision,
  type Item,
  type Release,
  type Reminder,
  SECRET_ENTRY,
  type Workflow,
} from "./store.ts";

export interface Reply {
  text: string;
  alert: boolean;
}

/**
 * The longest label of an entry that a fix sends: the limit of `entries()` in
 * pager/core.mjs of repo-pager-control-template, whose job refuses a longer one
 * without an answer, so a change of one side changes the other.
 */
export const MAX_LABEL = 300;

const done = (text: string): Reply => ({ text, alert: false });
const refused = (text: string): Reply => ({ text, alert: true });

/**
 * Show a thing whose action went through on GitHub, such as a reply that it posted
 * or a fix that it started. Its new state is kept also when the message can't show
 * it, such as when Telegram answers a 429 that asks to wait long or a 5xx, or can't
 * be reached: a second press of a button that the message still shows is then
 * refused as out of date, rather than acting on GitHub twice, the press still gets
 * the answer of its action, and the next change of the thing shows the right
 * message.
 */
async function acted(context: Context, item: Item): Promise<void> {
  try {
    await show(context, item);
  } catch (error) {
    console.warn(
      `Telegram shows no change after an action on GitHub: ${describe(error)}; kept the new state`,
    );
    await context.store.put(item);
  }
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
  await acted(context, item);
  return done(context.t("answer.merging"));
}

async function fix(context: Context, item: Alarm | Alert): Promise<Reply> {
  // A secret that leaked is revoked where it was issued, which no change of the
  // code does, and Claude sees no alert of secret scanning; only a person can
  // upload the social preview, which no API offers. The control repository
  // refuses the whole fix for an entry outside its repository, such as an event
  // of GitHub that failed on the app's Advanced page, or one whose page GitHub
  // didn't name, and for a label that is too long, such as that of an alert with
  // a long description and path: Claude gets the rest, each label cut.
  const repository = `https://github.com/${item.repo}/`;
  const entries = item.entries
    .filter(
      (entry) =>
        !entry.key.startsWith(SECRET_ENTRY) &&
        entry.upload === undefined &&
        entry.url.startsWith(repository),
    )
    .map(({ label, url }) => ({ label: cut(label, MAX_LABEL), url }));
  if (entries.length === 0) {
    return refused(context.t("answer.nothingToFix"));
  }
  const failed = await toControl(context, "pager-fix", {
    item: item.id,
    repo: item.repo,
    kind: item.kind,
    entries,
  });
  if (failed !== null) {
    return refused(failed);
  }
  item.state = "fixing";
  item.jobStarted = context.now();
  await acted(context, item);
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
      await acted(context, item);
    }
  }
  if (started.size > 0) {
    return done(context.t("answer.rerun"));
  }
  return refused(
    context.t(running ? "answer.rerunRunning" : "answer.rerunPassed"),
  );
}

/**
 * Run the failed jobs of the newest run that a workflow knows again, after the
 * same look at the run as for an alarm. The message says that they run, until the
 * run fails again, which edits it, passes, which turns it ✅, or is cancelled,
 * which brings its buttons back with a note.
 */
async function rerunWorkflow(context: Context, item: Workflow): Promise<Reply> {
  const run = await context.github.workflowRun(
    item.installation,
    item.repo,
    item.run,
  );
  if (run.status !== "completed") {
    return refused(context.t("answer.rerunRunning"));
  }
  if (PASSED.has(run.conclusion ?? "")) {
    return refused(context.t("answer.rerunPassed"));
  }
  await context.github.rerunFailedJobs(item.installation, item.repo, item.run);
  item.state = "rerunning";
  item.note = null;
  await acted(context, item);
  return done(context.t("answer.rerunWorkflow"));
}

async function draft(context: Context, item: Contribution): Promise<Reply> {
  const failed = await askForDraft(context, item);
  if (failed !== null) {
    return refused(failed);
  }
  await acted(context, item);
  return done(context.t("answer.drafting"));
}

async function assistant(context: Context, item: Contribution): Promise<Reply> {
  try {
    await context.github.issueAssistant(item.repo, item.number);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      return refused(context.t("answer.noOverride", { repo: item.repo }));
    }
    // GitHub answers 404 for a repository without the workflow of the issue
    // assistant, which only a repository of the blueprint has, and for one that
    // GITHUB_USER_TOKEN can't see.
    if (error instanceof GitHubError && error.status === 404) {
      return refused(context.t("answer.noAssistant", { repo: item.repo }));
    }
    throw error;
  }
  item.note = context.t("note.assistant");
  await acted(context, item);
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
  // A discussion takes the reply in its thread, as the app; an issue or a pull
  // request a comment in the maintainer's name.
  if (item.discussion === undefined) {
    await context.github.comment(item.repo, item.number, item.draft);
    item.note = context.t("note.sent");
  } else {
    await context.github.reply(
      item.installation,
      item.repo,
      item.discussion,
      item.draft,
    );
    item.note = context.t("note.replied");
  }
  item.state = "sent";
  await acted(context, item);
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

/**
 * Save the answer to a decision in the control repository, where the agent that
 * asked reads it, and show it: the place of an option and its text, or no place and
 * the maintainer's own words, in the same file, so that the agent reads both alike.
 * When GitHub refuses, it throws, and the question stays open, so that the answer
 * can be saved again.
 */
export async function answerDecision(
  context: Context,
  item: Decision,
  choice: number | null,
  answer: string,
): Promise<void> {
  await context.github.saveAnswer(item.installation, item.repo, item.ask, {
    id: item.ask,
    question: item.question,
    options: item.options,
    choice,
    answer,
    answered: new Date(context.now()).toISOString(),
  });
  item.state = "answered";
  item.choice = choice;
  if (choice === null) {
    item.ownAnswer = answer;
  }
  await acted(context, item);
}

/** Save the option of a decision whose button the maintainer pressed. */
async function choose(
  context: Context,
  item: Decision,
  place: number | null,
): Promise<Reply> {
  const option = item.options[place ?? -1];
  if (place === null || option === undefined) {
    return refused(context.t("answer.unknown"));
  }
  await answerDecision(context, item, place, option);
  return done(context.t("answer.chosen", { option }));
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
        return item.kind === "workflow"
          ? await rerunWorkflow(context, item)
          : await rerun(context, item as Alarm);
      case "draft":
        return await draft(context, item as Contribution);
      case "assistant":
        return await assistant(context, item as Contribution);
      case "send":
        return await send(context, item as Contribution, pressed.version);
      case "edit":
        return await edit(context, item as Contribution);
      case "choose":
        return await choose(context, item as Decision, pressed.version);
    }
  } catch (error) {
    if (error instanceof NoUserToken) {
      return refused(context.t("answer.noUserToken"));
    }
    if (error instanceof UserTokenRefused) {
      return refused(context.t("answer.userTokenRefused"));
    }
    // A call that ran past its deadline may have acted all the same.
    if (error instanceof NoAnswer) {
      return refused(context.t("answer.noAnswer"));
    }
    if (error instanceof GitHubError) {
      return refused(context.t("answer.refused", { detail: error.detail }));
    }
    throw error;
  }
}
