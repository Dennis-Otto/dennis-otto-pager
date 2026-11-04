/**
 * What the control repository sends back: a draft of a reply, a note on a thing or
 * for the chat, an answer that proposes one action of the allowlist, or the end of
 * a job that failed. Its workflow signs each request with CONTROL_SECRET, over the
 * time and the body, and the pager takes a request for five minutes only. What it
 * says is shown, escaped, and never run: an action needs a button of the
 * allowlist, which a proposal only offers, and the maintainer presses.
 */
import { type Action, allowed, callbackData, LABELS } from "./buttons.ts";
import { verifySignature } from "./crypto.ts";
import { type Context, show } from "./pager.ts";
import { html, link } from "./render.ts";
import { type Item, itemId, keys } from "./store.ts";
import type { Keyboard } from "./telegram.ts";
import { MAX_DRAFT } from "./updates.ts";

/** How old a signed request of the control repository may be, in seconds. */
export const WINDOW = 300;

/** What a run of Claude took from the maintainer's weekly limit. */
export interface Usage {
  turns: number;
  seconds: number;
}

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
  later: ALL,
  ignore: ALL,
};

export type Message = (
  | { type: "draft"; item: string; text: string }
  | { type: "note"; item?: string; text: string }
  | { type: "failed"; item: string; text: string }
  | { type: "proposal"; text: string; action: Action; target: Target }
) & { usage?: Usage };

type Fields = Partial<Record<string, unknown>>;

function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** The usage of a body: undefined when it has none, null when it is wrong. */
function usageOf(value: unknown): Usage | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const usage = value as Fields | null;
  if (!count(usage?.turns) || !count(usage?.seconds)) {
    return null;
  }
  return { turns: usage.turns, seconds: usage.seconds };
}

function targetOf(action: unknown, value: unknown): Target | null {
  const kinds = PROPOSABLE[action as Action];
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
    case "failed":
      return typeof item === "string" ? { type, item, text } : null;
    case "note":
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
  if (message === null || usage === null) {
    return null;
  }
  return usage === undefined ? message : { ...message, usage };
}

/** The line that says what a run of Claude took from the weekly limit. */
export function usageLine(usage: Usage | undefined): string | null {
  if (usage === undefined) {
    return null;
  }
  const turns = usage.turns === 1 ? "1 turn" : `${usage.turns} turns`;
  return `🧮 Claude: ${turns}, ${usage.seconds} s, from your weekly limit`;
}

/** A note below a thing, with the usage of Claude on a line of its own. */
function noted(text: string, usage: Usage | undefined): string {
  const line = usageLine(usage);
  return line === null ? text : `${text}\n${line}`;
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
function whereIs(item: Item): string {
  switch (item.kind) {
    case "contribution":
    case "release":
      return link(`${item.repo}#${item.number}`, item.url);
    case "alarm":
      return link(item.repo, `https://github.com/${item.repo}/actions`);
    default:
      return link(
        `code scanning of ${item.repo}`,
        `https://github.com/${item.repo}/security/code-scanning`,
      );
  }
}

/**
 * An answer that proposes one action: a message of its own with a single ✅ Confirm
 * button, whose data is that of the thing's own button. A press runs it only while
 * the thing still offers it, as any press does, and then the button goes.
 */
async function propose(
  context: Context,
  message: Extract<Message, { type: "proposal" }>,
): Promise<Response> {
  const lines = [`🤖 ${html(message.text, MAX_DRAFT)}`];
  const { target } = message;
  const item = await context.store.get(await itemId(keyOf(target)));
  const label = html(LABELS[message.action]);
  let keyboard: Keyboard = [];
  if (item === null) {
    lines.push(
      `<i>No button: the pager shows no ${target.kind} of ${html(target.repo)} for ${label}.</i>`,
    );
  } else if (!allowed(item).includes(message.action)) {
    lines.push(
      `<i>No button: ${whereIs(item)} doesn't offer ${label} now.</i>`,
    );
  } else {
    lines.push(`👉 ${label}: ${whereIs(item)}`);
    keyboard = [
      [
        {
          text: "✅ Confirm",
          callback_data: callbackData(message.action, item),
        },
      ],
    ];
  }
  const line = usageLine(message.usage);
  if (line !== null) {
    lines.push(`<i>${line}</i>`);
  }
  await context.telegram.send(lines.join("\n\n"), keyboard);
  return new Response(keyboard.length === 0 ? "said" : "proposed");
}

/** The states in which a job of the control repository runs, and the one before. */
const RUNNING: Partial<Record<string, Item["state"]>> = {
  "contribution:drafting": "new",
  "alarm:fixing": "open",
  "alert:fixing": "open",
};

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
    return propose(context, message);
  }
  if (message.item === undefined) {
    const line = usageLine(message.usage);
    await context.telegram.say(
      `🤖 ${html(message.text, MAX_DRAFT)}${line === null ? "" : `\n\n<i>${line}</i>`}`,
    );
    return new Response("said");
  }
  const item = await context.store.get(message.item);
  if (item === null) {
    return new Response("Not Found", { status: 404 });
  }
  if (message.type === "note") {
    item.note = noted(message.text, message.usage);
    await show(context, item);
    return new Response("noted");
  }
  if (message.type === "failed") {
    const before = RUNNING[`${item.kind}:${item.state}`];
    if (before === undefined) {
      return new Response("Conflict", { status: 409 });
    }
    (item as { state: Item["state"] }).state = before;
    item.note = noted(message.text, message.usage);
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
  item.note = usageLine(message.usage);
  // A new message, which notifies: the maintainer asked for the draft.
  await show(context, item, true);
  return new Response("drafted");
}
