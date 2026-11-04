/**
 * What the control repository sends back: a draft of a reply, or a note on a thing
 * or for the chat. Its workflow signs each request with CONTROL_SECRET, over the
 * time and the body, and the pager takes a request for five minutes only. What it
 * says is shown, escaped, and never run: an action needs a button of the allowlist.
 */
import { verifySignature } from "./crypto.ts";
import { type Context, show } from "./pager.ts";
import { html } from "./render.ts";
import { MAX_DRAFT } from "./updates.ts";

/** How old a signed request of the control repository may be, in seconds. */
export const WINDOW = 300;

export type Message =
  | { type: "draft"; item: string; text: string }
  | { type: "note"; item?: string; text: string };

function parse(body: string): Message | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  const message = value as Partial<Record<string, unknown>> | null;
  const text = message?.text;
  const item = message?.item;
  if (typeof text !== "string" || text.trim() === "") {
    return null;
  }
  if (message?.type === "draft" && typeof item === "string") {
    return { type: "draft", item, text };
  }
  if (
    message?.type === "note" &&
    (item === undefined || typeof item === "string")
  ) {
    return item === undefined
      ? { type: "note", text }
      : { type: "note", item, text };
  }
  return null;
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
  if (message.item === undefined) {
    await context.telegram.say(`🤖 ${html(message.text, MAX_DRAFT)}`);
    return new Response("said");
  }
  const item = await context.store.get(message.item);
  if (item === null) {
    return new Response("Not Found", { status: 404 });
  }
  if (message.type === "note") {
    item.note = message.text;
    await show(context, item);
    return new Response("noted");
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
  item.note = null;
  // A new message, which notifies: the maintainer asked for the draft.
  await show(context, item, true);
  return new Response("drafted");
}
