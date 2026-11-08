/**
 * Repo Pager: a Telegram bot on a Cloudflare Worker that tells its maintainer
 * only what needs them in their GitHub repositories, and acts on it with a button.
 *
 * The handlers of the Worker: the webhook of Telegram at /telegram, that of the
 * GitHub App at /github, the answers of the control repository at /control, and the
 * schedule. The Worker turns away what no route serves; the one Durable Object of
 * src/serial.ts runs the rest, one change at a time. Each request proves where it
 * comes from before anything else runs, and no log names a secret or what an issue
 * says.
 */
import type { Route } from "./routes.ts";
import { type PagerEnv, readSettings, type Settings } from "./settings.ts";

export { Serial } from "./serial.ts";

const ROUTES: ReadonlySet<string> = new Set<Route>([
  "/telegram",
  "/github",
  "/control",
]);

function configured(env: PagerEnv): Settings | null {
  const read = readSettings(env);
  if ("missing" in read) {
    console.error("The pager misses settings:", read.missing.join(", "));
    return null;
  }
  return read.settings;
}

/** The one Durable Object of the pager. */
function serial(env: PagerEnv) {
  return env.SERIAL.getByName("pager");
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
    return serial(env).handle(settings, url.pathname as Route, request);
  },

  async scheduled(_controller, env, executionContext) {
    const settings = configured(env);
    if (settings !== null) {
      executionContext.waitUntil(serial(env).schedule(settings));
    }
  },
} satisfies ExportedHandler<PagerEnv>;
