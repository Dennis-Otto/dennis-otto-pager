// /status in the chat: the health of the pager, as the control repository asks for
// it once a day, in the words of the maintainer, and whether the app is installed
// on the control repository; each line that fails names the step of docs/setup.md
// that fixes it, and no line names a secret.
import { describe, expect, it } from "vitest";

import { FAILED, type Failure, RAN } from "../src/health.ts";
import { SCHEDULE_WITHIN, WEBHOOK_WITHIN } from "../src/status.ts";
import { TOKENS, type Tokens } from "../src/tokens.ts";
import { handleUpdate } from "../src/updates.ts";
import {
  appKey,
  CHAT,
  json,
  START,
  type World,
  withControl,
  world,
} from "./helpers.ts";

const APP = { slug: "repo-pager", owner: { login: "Dennis-Otto" } };
const MINUTE = 60 * 1000;

function message(text: string, extra: object = {}) {
  return {
    message: {
      message_id: 500,
      chat: { id: CHAT },
      from: { id: CHAT },
      text,
      ...extra,
    },
  };
}

/** A webhook that Telegram delivers to, with what getWebhookInfo says besides. */
function webhook(w: World, extra: object = {}): void {
  w.net.on("POST", /\/getWebhookInfo$/, () =>
    json({
      ok: true,
      result: {
        url: "https://pager.example/telegram",
        pending_update_count: 1,
        ...extra,
      },
    }),
  );
}

/** Ask for /status, and return the lines of its answer. */
async function asked(w: World, extra: object = {}): Promise<string[]> {
  expect(await handleUpdate(w.context, message("/status", extra))).toBe(
    "status",
  );
  const sent = w.net.telegram("sendMessage");
  expect(sent).toHaveLength(1);
  return String(sent[0]?.body.text).split("\n");
}

describe("/status", () => {
  it("says that all is well, in the thread it was asked in, and names no secret", async () => {
    const w = await world({ tokenExpires: "2027-10-07" });
    withControl(w.net).on("GET", "/app", () => json(APP));
    webhook(w, {
      // An error of the webhook from more than a day ago is over.
      last_error_date: (START - WEBHOOK_WITHIN - MINUTE) / 1000,
      last_error_message: "Old trouble",
    });
    await w.context.local.put(RAN, START - 10 * MINUTE);
    // A failure that a later run got past is over too.
    await w.context.local.put<Failure>(FAILED, {
      at: new Date(START - 20 * MINUTE).toISOString(),
      what: "remind tokens",
      error: "GitHub answered 502",
    });
    await w.context.local.put<Tokens>(TOKENS, {
      checked: { day: "2026-11-04", token: "x" },
      user: { expires: "2027-01-01" },
      fix: { expires: "2027-02-01" },
    });
    const lines = await asked(w, {
      message_thread_id: 77,
      is_topic_message: true,
    });
    expect(lines).toEqual([
      "🩺 <b>The status of your pager</b>",
      "✅ The schedule last ran to its end on 2026-11-04 at 07:50 UTC.",
      "✅ Telegram takes the bot, and its webhook is set.",
      "✅ GitHub takes the key of the app.",
      "✅ The app is installed on Dennis-Otto/control, the control repository.",
      "✅ The token of Claude in Dennis-Otto/control: expires in 337 days, on 2027-10-07.",
      "✅ GITHUB_USER_TOKEN of the Worker: expires in 58 days, on 2027-01-01.",
      "✅ PAGER_FIX_TOKEN in Dennis-Otto/control: expires in 89 days, on 2027-02-01.",
    ]);
    const sent = w.net.telegram("sendMessage")[0]?.body;
    expect(sent?.message_thread_id).toBe(77);
    const text = JSON.stringify(sent);
    for (const secret of [
      "123:test",
      "telegram-secret",
      "github-secret",
      "control-secret",
      "user-token",
      "PRIVATE KEY",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain((await appKey()).pem.slice(40, 80));
    // It changes nothing: no reaction, and nothing goes to the control repository.
    expect(w.net.telegram("setMessageReaction")).toHaveLength(0);
    expect(w.net.calls.some((call) => call.url.endsWith("/dispatches"))).toBe(
      false,
    );
  });

  it("tells a new instance the step of the setup that each missing piece needs", async () => {
    const w = await world({ userToken: null });
    w.net.on("GET", "/app", () =>
      json({ message: "A JSON web token could not be decoded" }, 401),
    );
    expect(await asked(w)).toEqual([
      "🩺 <b>The status of your pager</b>",
      "⚠️ The schedule never ran to its end: it runs every 15 minutes once the Worker is deployed, as step 2 of docs/setup.md says. Its log in Cloudflare says why a run failed.",
      "⚠️ Telegram takes the bot, but no webhook is set, so the bot gets no update: set it, as step 5 of docs/setup.md says.",
      "⚠️ GitHub refuses the app: GitHub answered 401: A JSON web token could not be decoded. Are GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY of the Worker right? Step 4 of docs/setup.md sets them.",
      "⚠️ The app isn't installed on Dennis-Otto/control, the control repository, so free text and the buttons that start a job reach nothing: install it there, as step 4 of docs/setup.md says.",
      "ℹ️ GITHUB_USER_TOKEN of the Worker isn't set, so ✅ Send and 🤖 Assistant again say what is missing, and the rest works. Step 3 of docs/setup.md sets it.",
      "ℹ️ PAGER_FIX_TOKEN in Dennis-Otto/control: its day comes with the next run of Health of the control repository, which step 7 of docs/setup.md sets up.",
    ]);
  });

  it("names what fails: a late schedule and its last failure, the webhook, Telegram, the control repository and the tokens", async () => {
    const w = await world({ tokenExpires: "2026-11-05" });
    w.net
      .on("GET", "/app", () => json(APP))
      .on("GET", "/repos/Dennis-Otto/control/installation", () =>
        json({ message: "Server <error>" }, 500),
      );
    webhook(w, {
      last_error_date: (START - 2 * MINUTE) / 1000,
      last_error_message: "Wrong response from the webhook: 502 <Bad Gateway>",
    });
    await w.context.local.put(RAN, START - SCHEDULE_WITHIN - MINUTE);
    await w.context.local.put<Failure>(FAILED, {
      at: new Date(START - 5 * MINUTE).toISOString(),
      what: "show item i0123456789abcde",
      error: "Telegram editMessageText: Bad Request: <can't parse>",
    });
    await w.context.local.put<Tokens>(TOKENS, {
      checked: { day: "2026-11-04", token: "x" },
      user: { expires: null, refused: "2026-11-03" },
      fix: { expires: "2026-11-04" },
    });
    expect(await asked(w)).toEqual([
      "🩺 <b>The status of your pager</b>",
      "⚠️ The schedule last ran to its end on 2026-11-04 at 06:59 UTC, more than an hour ago, though it runs every 15 minutes: does the Worker still have its cron trigger, which step 2 of docs/setup.md deploys? Its log in Cloudflare says why a run failed.",
      "⚠️ A run of the schedule failed on 2026-11-04 at 07:55 UTC, at show item i0123456789abcde: Telegram editMessageText: Bad Request: &lt;can't parse&gt;. The next run tries again, and the log of the Worker in Cloudflare has the whole error.",
      "✅ Telegram takes the bot, and its webhook is set.",
      "⚠️ The webhook of Telegram failed on 2026-11-04 at 07:58 UTC: Wrong response from the webhook: 502 &lt;Bad Gateway&gt;. Updates waiting: 1. Step 5 of docs/setup.md sets it again, and the log of the Worker in Cloudflare says why it failed.",
      "✅ GitHub takes the key of the app.",
      "⚠️ Whether the app is installed on Dennis-Otto/control, the control repository, is unknown: GitHub answered 500: Server &lt;error&gt;.",
      "⚠️ The token of Claude in Dennis-Otto/control: expires in 1 day, on 2026-11-05. Renew it, as Later on in docs/setup.md says.",
      "⚠️ GITHUB_USER_TOKEN of the Worker: GitHub refuses it since 2026-11-03, as it expired or was revoked. Make a new one, as step 3 of docs/setup.md says.",
      "⚠️ PAGER_FIX_TOKEN in Dennis-Otto/control: expired on 2026-11-04. Renew it, as Later on in docs/setup.md says.",
    ]);
  });

  it("says when Telegram refuses the bot, a token that names no day, one not checked yet, and one due within weeks", async () => {
    const w = await world();
    w.net
      .on("POST", /\/getMe$/, () =>
        json({ ok: false, error_code: 401, description: "Unauthorized" }, 401),
      )
      .on("GET", "/app", () => json(APP));
    withControl(w.net);
    await w.context.local.put<Tokens>(TOKENS, {
      fix: { expires: null },
    });
    const first = await asked(w);
    expect(first.slice(2, 3)).toEqual([
      "⚠️ Telegram refuses the bot: Telegram getMe: Unauthorized. Set TELEGRAM_BOT_TOKEN of the Worker again, as step 3 of docs/setup.md says.",
    ]);
    expect(first.slice(-2)).toEqual([
      "✅ GITHUB_USER_TOKEN of the Worker is set; the next run of the schedule reads its day from GitHub.",
      "✅ PAGER_FIX_TOKEN in Dennis-Otto/control: GitHub names no day on which it expires.",
    ]);

    const soon = await world();
    await soon.context.local.put<Tokens>(TOKENS, {
      checked: { day: "2026-11-04", token: "x" },
      user: { expires: "2026-11-20" },
    });
    expect((await asked(soon)).at(-2)).toBe(
      "⚠️ GITHUB_USER_TOKEN of the Worker: expires in 16 days, on 2026-11-20. Renew it, as Later on in docs/setup.md says.",
    );
  });

  it("speaks the language of the pager, and takes the name of the bot after the command", async () => {
    const w = await world({ language: "de", tokenExpires: "2027-10-07" });
    withControl(w.net).on("GET", "/app", () => json(APP));
    webhook(w);
    await w.context.local.put(RAN, START - 10 * MINUTE);
    const lines = await asked(w, { text: "/status@repo_pager_bot" });
    expect(lines.slice(0, 3)).toEqual([
      "🩺 <b>Der Stand deines Pagers</b>",
      "✅ Der Zeitplan lief zuletzt am 04.11.2026 um 07:50 UTC bis zu seinem Ende.",
      "✅ Telegram nimmt den Bot an, und sein Webhook ist gesetzt.",
    ]);
    expect(lines).toContain(
      "✅ Claude-Token in Dennis-Otto/control: läuft in 337 Tagen ab, am 07.10.2027.",
    );
  });

  it("is named by /help, and a word that only starts like it is free text", async () => {
    const w = await world();
    await handleUpdate(w.context, message("/help"));
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "/status says how the pager is",
    );
    expect(await handleUpdate(w.context, message("/statuses"))).toBe(
      "free text without a control repository",
    );
  });
});
