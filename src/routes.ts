/**
 * The routes of the pager, as the one Durable Object of the pager runs them: the
 * webhook of Telegram, that of the GitHub App and the answers of the control
 * repository. Each request proves where it comes from first; what it then changes
 * runs one at a time, through the exclusive of the context, because the state in
 * Workers KV has no compare-and-swap.
 */
import { describe } from "./context.ts";
import { handleControl } from "./control.ts";
import { safeEqual, verifySignature } from "./crypto.ts";
import { apply, type Context } from "./pager.ts";
import { classify, type Payload } from "./rules.ts";
import { runSchedule } from "./schedule.ts";
import { handleUpdate, type Update } from "./updates.ts";

export type Route = "/telegram" | "/github" | "/control";

async function telegram(context: Context, request: Request): Promise<Response> {
  const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(secret, context.settings.telegramSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let update: Update;
  try {
    update = await request.json<Update>();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  try {
    await context.exclusive(() => handleUpdate(context, update));
  } catch (error) {
    // Telegram sends an update again until it gets a 200, and a button pressed
    // twice could act twice: the error goes to the log, and the update is done.
    console.error("A Telegram update failed:", describe(error));
  }
  return new Response("ok");
}

async function github(context: Context, request: Request): Promise<Response> {
  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (
    !(await verifySignature(context.settings.githubSecret, body, signature))
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "";
  if (event === "ping") {
    return new Response("pong");
  }
  let payload: Payload;
  try {
    payload = JSON.parse(body) as Payload;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const outcome = classify(event, payload, context.settings.maintainer);
  if ("ignored" in outcome) {
    return new Response(`ignored: ${outcome.ignored}`);
  }
  const signal = outcome.signal;
  try {
    return new Response(await context.exclusive(() => apply(context, signal)));
  } catch (error) {
    // GitHub delivers it again when asked to, in the settings of the app.
    console.error(`A GitHub ${event} failed:`, describe(error));
    return new Response("failed", { status: 500 });
  }
}

/** Serve a request that the Worker let through: its method and route are known. */
export function serve(
  context: Context,
  route: Route,
  request: Request,
): Promise<Response> {
  switch (route) {
    case "/telegram":
      return telegram(context, request);
    case "/github":
      return github(context, request);
    default:
      return context.exclusive(() => handleControl(context, request));
  }
}

/** One run of the schedule; a failure goes to the log. */
export async function schedule(context: Context): Promise<void> {
  try {
    await context.exclusive(() => runSchedule(context));
  } catch (error) {
    console.error("The schedule failed:", describe(error));
  }
}
