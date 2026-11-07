/**
 * What the control repository sends back: a draft of a reply, a note on a thing or
 * for the chat, an answer that proposes one action of the allowlist, or the end of
 * a job that failed. Its workflow signs each request with CONTROL_SECRET, over the
 * time and the body, and the pager takes a request for five minutes only. What it
 * says is shown, escaped, and never run: an action needs a button of the
 * allowlist, which a proposal only offers, and the maintainer presses. An answer to
 * a text of the maintainer turns the 👀 on that text into 👍, or 😢 when no answer
 * came to be, and goes into the thread that the text came from. A job of a thing
 * that ends without a change may propose one action of its thing, such as 🔁 Rerun
 * after an outage of GitHub, which comes as a proposal in the thing's topic.
 */
import { type Action, allowed, callbackData, label } from "./buttons.ts";
import { verifySignature } from "./crypto.ts";
import { type Context, draftOrWhyNot, show } from "./pager.ts";
import { html, link } from "./render.ts";
import { beforeJob, type Item, itemId, keys } from "./store.ts";
import { type Keyboard, REACTIONS, type Thread } from "./telegram.ts";
import type { Texts } from "./texts.ts";
import { MAX_DRAFT } from "./updates.ts";
import { footer, type Usage, usageOf } from "./usage.ts";

/** How old a signed request of the control repository may be, in seconds. */
export const WINDOW = 300;

/** The thing that a proposal acts on, named as the control repository knows it. */
export type Target =
  | { kind: "contribution"; repo: string; number: number }
  | { kind: "alarm" | "alert" | "release"; repo: string };

const ALL: readonly Target["kind"][] = [
  "contribution",
  "alarm",
  "alert",
  "release",
];

/**
 * The actions that a proposal may carry, and the kinds of thing each acts on.
 * ✅ Send and ✏️ Edit stay with the message of the draft, which shows the text
 * that they post.
 */
export const PROPOSABLE: Partial<Record<Action, readonly Target["kind"][]>> = {
  merge: ["release"],
  assistant: ["contribution"],
  draft: ["contribution"],
  fix: ["alarm", "alert"],
  rerun: ["alarm"],
  later: ALL,
  ignore: ALL,
};

/**
 * A body of the control repository. A note or a failure without an item, and a
 * proposal, answer in the chat; their message names the text of the maintainer that
 * they answer, if any. The failure of a thing's job may propose an action of the
 * allowlist for that thing, such as a fix that found an outage of GitHub.
 */
export type Message = (
  | { type: "draft"; item: string; text: string }
  | { type: "note"; item?: string; text: string }
  | { type: "failed"; item?: string; text: string; action?: Action }
  | { type: "proposal"; text: string; action: Action; target: Target }
) & { usage?: Usage; message?: number };

type Fields = Partial<Record<string, unknown>>;

/** Whether a value names an action that a proposal may carry. */
function proposable(action: unknown): action is Action {
  // Only an own key: "constructor" or "__proto__" would find the prototype's.
  return typeof action === "string" && Object.hasOwn(PROPOSABLE, action);
}

function targetOf(action: unknown, value: unknown): Target | null {
  const kinds = proposable(action) ? PROPOSABLE[action] : undefined;
  const target = value as Fields | null;
  const kind = target?.kind as Target["kind"];
  const repo = target?.repo;
  if (
    kinds === undefined ||
    !kinds.includes(kind) ||
    typeof repo !== "string" ||
    !/^[\w.-]+\/[\w.-]+$/.test(repo)
  ) {
    return null;
  }
  const number = target?.number;
  if (kind !== "contribution") {
    return number === undefined ? { kind, repo } : null;
  }
  return Number.isSafeInteger(number) && (number as number) > 0
    ? { kind, repo, number: number as number }
    : null;
}

function shape(message: Fields): Message | null {
  const { type, item, text, action } = message;
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }
  switch (type) {
    case "draft":
      return typeof item === "string" ? { type, item, text } : null;
    case "note":
      if (item === undefined) {
        return { type, text };
      }
      return typeof item === "string" ? { type, item, text } : null;
    case "failed":
      // Only the failure of a thing's job proposes an action, for that thing.
      if (action !== undefined) {
        return typeof item === "string" && proposable(action)
          ? { type, item, text, action }
          : null;
      }
      if (item === undefined) {
        return { type, text };
      }
      return typeof item === "string" ? { type, item, text } : null;
    case "proposal": {
      const target = targetOf(action, message.target);
      return target === null
        ? null
        : { type, text, action: action as Action, target };
    }
    default:
      return null;
  }
}

function parse(body: string): Message | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  const fields = (value ?? {}) as Fields;
  const message = shape(fields);
  const usage = usageOf(fields.usage);
  const asked = fields.message;
  if (
    message === null ||
    usage === null ||
    (asked !== undefined &&
      !(Number.isSafeInteger(asked) && (asked as number) > 0))
  ) {
    return null;
  }
  return {
    ...message,
    ...(usage === undefined ? {} : { usage }),
    ...(asked === undefined ? {} : { message: asked as number }),
  };
}

/** A note below a thing, with the footer of Claude on a line of its own. */
function noted(text: string, usage: Usage | undefined, t: Texts): string {
  const line = footer(usage, t);
  return line === null ? text : `${text}\n${line}`;
}

/**
 * The end of a text of the maintainer that a chat answer answers: its 👀 becomes 👍
 * when the answer came, or 😢 when none came to be, and it waits no longer. A late
 * answer, after the schedule gave up on it, still turns it into 👍.
 */
async function settle(
  context: Context,
  message: Message,
  answered: boolean,
): Promise<void> {
  if (message.message === undefined) {
    return;
  }
  await context.telegram.react(
    message.message,
    answered ? REACTIONS.answered : REACTIONS.failed,
  );
  await context.store.settle([message.message]);
}

/**
 * The thread of the chat that an answer goes into: that of the text of the
 * maintainer that it answers, which the store keeps while the text waits and for a
 * day after the schedule gave up on it. An answer to no text, such as one of a job started by hand, and one to a text that went
 * before the pager knew threads, go into the main view.
 */
async function threadFor(context: Context, message: Message): Promise<Thread> {
  return message.message === undefined
    ? null
    : context.store.thread(message.message);
}

/** Whether a request carries a fresh signature of the control repository. */
export async function signed(
  secret: string,
  request: Request,
  body: string,
  now: number,
): Promise<boolean> {
  const stamp = request.headers.get("x-pager-timestamp") ?? "";
  const seconds = Number(stamp);
  if (!/^\d+$/.test(stamp) || Math.abs(now / 1000 - seconds) > WINDOW) {
    return false;
  }
  return verifySignature(
    secret,
    `${stamp}.${body}`,
    request.headers.get("x-pager-signature"),
  );
}

/** The key of the thing that a proposal names, as the store keeps it. */
function keyOf(target: Target): string {
  return target.kind === "contribution"
    ? keys.contribution(target.repo, target.number)
    : keys[target.kind](target.repo);
}

/** A link to the thing on GitHub, named as the maintainer knows it. */
function whereIs(item: Item, t: Texts): string {
  switch (item.kind) {
    case "contribution":
    case "release":
      return link(`${item.repo}#${item.number}`, item.url);
    case "alarm":
      return link(item.repo, `https://github.com/${item.repo}/actions`);
    default:
      return link(
        t("proposal.codeScanning", { repo: item.repo }),
        `https://github.com/${item.repo}/security/code-scanning`,
      );
  }
}

/** What a proposal shows: its answer, the action and the thing that it acts on. */
interface Proposal {
  text: string;
  action: Action;
  target: Target;
  usage?: Usage;
}

/**
 * An answer that proposes one action: a message of its own in the thread given,
 * with a single ✅ Confirm button, whose data is that of the thing's own button. A
 * press runs it only while the thing still offers it, as any press does, and then
 * the button goes. Returns whether the message got its button.
 */
async function propose(
  context: Context,
  message: Proposal,
  item: Item | null,
  thread: Thread,
): Promise<boolean> {
  const { t } = context;
  const lines = [`🤖 ${html(message.text, MAX_DRAFT)}`];
  const { target } = message;
  const named = html(label(t, message.action));
  let keyboard: Keyboard = [];
  if (item === null) {
    const text = t("proposal.notShown", {
      kind: t(`kind.${target.kind}`),
      repo: html(target.repo),
      label: named,
    });
    lines.push(`<i>${text}</i>`);
  } else if (!allowed(item).includes(message.action)) {
    const text = t("proposal.notOffered", {
      thing: whereIs(item, t),
      label: named,
    });
    lines.push(`<i>${text}</i>`);
  } else {
    // A Merge names the version that its button merges, as the release's own message does.
    const version = item.kind === "release" ? ` ${html(item.version, 50)}` : "";
    lines.push(`👉 ${named}${version}: ${whereIs(item, t)}`);
    keyboard = [
      [
        {
          text: t("button.confirm"),
          callback_data: callbackData(message.action, item),
        },
      ],
    ];
  }
  const line = footer(message.usage, t);
  if (line !== null) {
    lines.push(`<i>${html(line)}</i>`);
  }
  await context.telegram.send(lines.join("\n\n"), keyboard, thread);
  return keyboard.length > 0;
}

/** Handle a request of the control repository. */
export async function handleControl(
  context: Context,
  request: Request,
): Promise<Response> {
  const secret = context.settings.controlSecret;
  if (secret === null) {
    return new Response("CONTROL_SECRET isn't set", { status: 503 });
  }
  const body = await request.text();
  if (!(await signed(secret, request, body, context.now()))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const message = parse(body);
  if (message === null) {
    return new Response("Bad Request", { status: 400 });
  }
  if (message.type === "proposal") {
    const { target } = message;
    const offered = await propose(
      context,
      message,
      await context.store.get(await itemId(keyOf(target))),
      await threadFor(context, message),
    );
    await settle(context, message, true);
    return new Response(offered ? "proposed" : "said");
  }
  if (message.item === undefined) {
    const line = footer(message.usage, context.t);
    await context.telegram.say(
      `🤖 ${html(message.text, MAX_DRAFT)}${line === null ? "" : `\n\n<i>${html(line)}</i>`}`,
      await threadFor(context, message),
    );
    await settle(context, message, message.type !== "failed");
    return new Response("said");
  }
  const item = await context.store.get(message.item);
  if (item === null) {
    return new Response("Not Found", { status: 404 });
  }
  // An answer ends the wait for the job, so the schedule leaves the thing alone.
  delete item.jobStarted;
  if (message.type === "note") {
    item.note = noted(message.text, message.usage, context.t);
    // The note that ends a job, such as a fix with its pull request, is a new
    // message in the thing's topic, which notifies, as its failure is: the
    // maintainer waits for it. Any other note edits the message in place.
    const ends = beforeJob(item) !== undefined;
    await show(context, item, ends);
    return new Response("noted");
  }
  if (item.kind === "contribution" && item.discussion?.redraft === true) {
    // A newer comment came while this job ran: its draft, or its failure,
    // belongs to an older comment, so it is dropped, and the draft for the
    // newest is asked for.
    const failed = await draftOrWhyNot(context, item);
    if (failed !== null) {
      delete item.discussion.redraft;
      item.state = "new";
    }
    item.note = failed;
    await show(context, item);
    return new Response("dropped");
  }
  if (message.type === "failed") {
    const before = beforeJob(item);
    if (before === undefined) {
      return new Response("Conflict", { status: 409 });
    }
    (item as { state: Item["state"] }).state = before;
    const { action } = message;
    if (
      action !== undefined &&
      (item.kind === "alarm" || item.kind === "alert") &&
      allowed(item).includes(action)
    ) {
      // A fix that found an outage of GitHub proposes 🔁 Rerun: the answer comes
      // as a proposal in the thing's topic, with one ✅ Confirm button, which
      // notifies, and the thing gets its buttons back in place.
      item.note = message.text;
      await show(context, item);
      await propose(
        context,
        { ...message, action, target: { kind: item.kind, repo: item.repo } },
        item,
        item.topic?.thread ?? null,
      );
      return new Response("proposed");
    }
    item.note = noted(message.text, message.usage, context.t);
    // A new message, which notifies: the maintainer waits for the job, and its
    // button is back, so that it can run again.
    await show(context, item, true);
    return new Response("reopened");
  }
  if (
    item.kind !== "contribution" ||
    !["new", "drafting", "draft"].includes(item.state)
  ) {
    return new Response("Conflict", { status: 409 });
  }
  if (message.text.length > MAX_DRAFT) {
    return new Response(`A draft has ${MAX_DRAFT} characters at most`, {
      status: 413,
    });
  }
  item.draft = message.text;
  item.draftVersion += 1;
  item.state = "draft";
  item.note = footer(message.usage, context.t);
  // A new message, which notifies: the maintainer asked for the draft.
  await show(context, item, true);
  return new Response("drafted");
}
