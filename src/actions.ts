/**
 * What each button does, from the allowlist of buttons.ts and nothing else. An
 * action checks again what it acts on, such as the head of a release pull request,
 * and writes only through the few calls of github.ts.
 */
import { allowed, type Press } from "./buttons.ts";
import { GitHubError } from "./github.ts";
import { type Context, show } from "./pager.ts";
import { releaseBlocker } from "./rules.ts";
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
    return refused(
      `The GitHub App isn't installed on ${repo}, which does this: install it there, as docs/setup.md says.`,
    );
  }
  await context.github.dispatch(installation, repo, eventType, payload);
  return null;
}

async function merge(context: Context, item: Release): Promise<Reply> {
  const pull = await context.github.pullRequest(
    item.installation,
    item.repo,
    item.number,
  );
  if (pull.head?.sha !== item.sha) {
    item.state = "updating";
    item.sha = pull.head?.sha ?? "";
    await show(context, item);
    return refused(
      "The release changed since this message: it comes back once its checks are green.",
    );
  }
  const blocker = releaseBlocker(
    pull,
    pull.base?.repo?.default_branch ?? "main",
  );
  if (blocker !== null) {
    return refused(`Not merged: ${blocker}.`);
  }
  await context.github.merge(
    item.installation,
    item.repo,
    item.number,
    item.sha,
  );
  item.state = "merging";
  await show(context, item);
  return done("Merging.");
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
  await show(context, item);
  return done(
    "Sent to the control repository: Claude looks for a fix, from your weekly limit.",
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
  await show(context, item);
  return done(
    "The control repository drafts a reply with Claude, from your weekly limit.",
  );
}

async function assistant(context: Context, item: Contribution): Promise<Reply> {
  try {
    await context.github.issueAssistant(item.repo, item.number);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      return refused(
        `The issue assistant of ${item.repo} doesn't take the override yet: it comes with the release of the blueprint that brings the runs by hand of the issue assistant. Nothing was started.`,
      );
    }
    throw error;
  }
  item.note = "🤖 The issue assistant answers again.";
  await show(context, item);
  return done("The issue assistant runs.");
}

async function send(
  context: Context,
  item: Contribution,
  version: number | null,
): Promise<Reply> {
  if (version !== item.draftVersion || item.draft === null) {
    return refused(
      "This draft is out of date: send the one that the message shows now.",
    );
  }
  await context.github.comment(item.repo, item.number, item.draft);
  item.state = "sent";
  item.note = "Posted in your name.";
  await show(context, item);
  return done("Sent.");
}

async function edit(context: Context, item: Contribution): Promise<Reply> {
  const prompt = await context.telegram.prompt(
    `✏️ Reply to this message with the new text of the reply to ${item.repo}#${item.number}. The message of the draft then shows your text, and "Send" posts it as it stands.`,
  );
  await context.store.setPendingEdit({ item: item.id, prompt });
  return done("Write the new text in reply.");
}

/** Run the action of a pressed button on its thing, if the thing still offers it. */
export async function press(
  context: Context,
  item: Item,
  pressed: Press,
): Promise<Reply> {
  if (!allowed(item).includes(pressed.action)) {
    return refused("This button is out of date.");
  }
  try {
    switch (pressed.action) {
      case "later": {
        const hours = context.settings.laterHours;
        item.snoozedUntil = context.now() + hours * 3600000;
        await show(context, item);
        return done(`Back in ${hours} h.`);
      }
      case "ignore":
        (item as Exclude<Item, Reminder>).state = "ignored";
        item.snoozedUntil = null;
        await show(context, item);
        return done("Ignored.");
      case "done":
        (item as Reminder).state = "done";
        item.snoozedUntil = null;
        await show(context, item);
        return done("Done.");
      case "merge":
        return await merge(context, item as Release);
      case "fix":
        return await fix(context, item as Alarm | Alert);
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
    if (error instanceof GitHubError) {
      return refused(`GitHub refused: ${error.detail}`);
    }
    throw error;
  }
}
