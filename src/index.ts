/**
 * Dennis Otto Pager: a Telegram bot on a Cloudflare Worker that tells its maintainer
 * only what needs them in their GitHub repositories, and acts on it with a button.
 *
 * The handlers of the Worker: the webhook of Telegram at /telegram, that of the
 * GitHub App at /github, the answers of the control repository at /control, and the
 * schedule. Each request proves where it comes from before anything else runs, and
 * no log names a secret or what an issue says.
 */
import { describe, makeContext } from "./context.ts";
import { handleControl } from "./control.ts";
import { safeEqual, verifySignature } from "./crypto.ts";
import { apply, type Context } from "./pager.ts";
import { classify, type Payload } from "./rules.ts";
import { runSchedule } from "./schedule.ts";
import { type PagerEnv, readSettings, type Settings } from "./settings.ts";
import { handleUpdate, type Update } from "./updates.ts";

const ROUTES = new Set(["/telegram", "/github", "/control"]);

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
    await handleUpdate(context, update);
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
  try {
    return new Response(await apply(context, outcome.signal));
  } catch (error) {
    // GitHub delivers it again when asked to, in the settings of the app.
    console.error(`A GitHub ${event} failed:`, describe(error));
    return new Response("failed", { status: 500 });
  }
}

function configured(env: PagerEnv): Settings | null {
  const read = readSettings(env);
  if ("missing" in read) {
    console.error("The pager misses settings:", read.missing.join(", "));
    return null;
  }
  return read.settings;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && ["GET", "HEAD"].includes(request.method)) {
      return new Response("ok");
    }
    if (!ROUTES.has(url.pathname)) {
      return new Response("Not Found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }
    const settings = configured(env);
    if (settings === null) {
      return new Response("Service Unavailable", { status: 503 });
    }
    const context = makeContext(settings, env);
    switch (url.pathname) {
      case "/telegram":
        return telegram(context, request);
      case "/github":
        return github(context, request);
      default:
        return handleControl(context, request);
    }
  },

  async scheduled(_controller, env, executionContext) {
    const settings = configured(env);
    if (settings !== null) {
      executionContext.waitUntil(
        runSchedule(makeContext(settings, env)).then(
          () => undefined,
          (error: unknown) => {
            console.error("The schedule failed:", describe(error));
          },
        ),
      );
    }
  },
} satisfies ExportedHandler<PagerEnv>;
