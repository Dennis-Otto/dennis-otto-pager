// The security of a repository: a private vulnerability report is a thing of its
// own under embargo, whose summary and description reach no message, log or
// record, and which the schedule reminds of once while it waits in triage; an
// alert of secret scanning is an entry of the security message of its repository,
// next to code scanning, named by the kind of its secret and its file, never the
// secret.
import { env } from "cloudflare:test";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { press } from "../src/actions.ts";
import { REMINDER_CALLS, remindAdvisories } from "../src/advisories.ts";
import { allowed, keyboard } from "../src/buttons.ts";
import { hmacHex } from "../src/crypto.ts";
import { SUBREQUESTS } from "../src/deliveries.ts";
import { forget } from "../src/github.ts";
import worker from "../src/index.ts";
import { apply } from "../src/pager.ts";
import { classify, type Payload, type Signal } from "../src/rules.ts";
import { runSchedule } from "../src/schedule.ts";
import type { PagerEnv } from "../src/settings.ts";
import { type Advisory, type Alert, itemId, keys } from "../src/store.ts";
import { TOPIC_COLORS } from "../src/telegram.ts";
import { texts } from "../src/texts.ts";
import { about } from "../src/topics.ts";
import {
  appKey,
  CHAT,
  json,
  Net,
  REPO,
  START,
  type World,
  withTopics,
  world,
} from "./helpers.ts";

const ME = "Dennis-Otto";
const DAY = 24 * 60 * 60 * 1000;
const GHSA = "GHSA-4f6x-8m2c-jq7p";
const ADVISORY = `https://github.com/${REPO}/security/advisories/${GHSA}`;
const STATE = `/repos/${REPO}/security-advisories/${GHSA}`;
const LOCATIONS = /\/secret-scanning\/alerts\/(\d+)\/locations\?per_page=1$/;
/** What a report says and a secret, which nothing of the pager may ever show. */
const SUMMARY = "Remote code execution through the webhook route";
const DESCRIPTION = "Send a crafted payload to /github and the Worker runs it";
const SECRET = "ghp_0123456789abcdefTHISISTHESECRET";

const repository = {
  full_name: REPO,
  default_branch: "main",
  owner: { login: ME, type: "User" },
};
const at = { repo: REPO, installation: 9 };

/** An event of the demo repository; its fields as GitHub sends them, more than the rules read. */
function event(extra: Record<string, unknown>): Payload {
  return { repository, installation: { id: 9 }, ...extra } as Payload;
}

/** A report as GitHub sends it, with its summary and description. */
function report(extra: Record<string, unknown> = {}) {
  return {
    ghsa_id: GHSA,
    cve_id: null,
    html_url: ADVISORY,
    summary: SUMMARY,
    description: DESCRIPTION,
    severity: "high",
    state: "triage",
    created_at: new Date(START).toISOString(),
    ...extra,
  };
}

/** An alert of secret scanning as GitHub sends it, with a secret that its webhook never carries. */
function secretAlert(extra: Record<string, unknown> = {}) {
  return {
    number: 3,
    html_url: `https://github.com/${REPO}/security/secret-scanning/3`,
    secret_type: "mailchimp_api_key",
    secret_type_display_name: "Mailchimp API Key",
    resolution: null,
    publicly_leaked: false,
    secret: SECRET,
    ...extra,
  };
}

const reported: Signal = {
  ...at,
  type: "advisory",
  ghsa: GHSA,
  url: ADVISORY,
  severity: "high",
  reported: START,
};

function secret(number: number, leaked = false): Signal {
  return {
    ...at,
    type: "secret-open",
    key: `secret:${number}`,
    number,
    what: "Mailchimp API Key",
    leaked,
    url: `https://github.com/${REPO}/security/secret-scanning/${number}`,
  };
}

/** A world with topics, in which secret scanning found each secret in config/.env. */
async function security(language: "en" | "de" = "en"): Promise<World> {
  const w = await world({ language });
  withTopics(w.net);
  w.net.on("GET", LOCATIONS, () =>
    json([
      {
        type: "commit",
        details: { path: "config/.env", blob_sha: "b1", commit_sha: "c1" },
      },
    ]),
  );
  return w;
}

async function advisory(w: World): Promise<Advisory> {
  return (await w.context.store.get(
    await itemId(keys.advisory(REPO, GHSA)),
  )) as Advisory;
}

async function bundle(w: World): Promise<Alert> {
  return (await w.context.store.get(await itemId(keys.alert(REPO)))) as Alert;
}

// biome-ignore lint/suspicious/noExplicitAny: the recorded JSON of a call.
function sent(w: World): any[] {
  return w.net.telegram("sendMessage").map((call) => call.body);
}

let logs: string[];

beforeEach(() => {
  logs = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
      logs.push(parts.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the rules of a vulnerability report", () => {
  it("make a report a thing with its severity, its link and its day, and nothing that it says", () => {
    const outcome = classify(
      "repository_advisory",
      event({ action: "reported", repository_advisory: report() }),
      ME,
    );
    expect(outcome).toEqual({ signal: reported });
    expect(JSON.stringify(outcome)).not.toContain("Remote code");
    expect(JSON.stringify(outcome)).not.toContain("crafted");
  });

  it("take a report without a severity or a day as it comes", () => {
    for (const severity of [null, undefined, "moderate", "HIGH"]) {
      expect(
        classify(
          "repository_advisory",
          event({
            action: "reported",
            repository_advisory: report({ severity, created_at: null }),
          }),
          ME,
        ),
      ).toEqual({ signal: { ...reported, severity: null, reported: null } });
    }
    for (const severity of ["critical", "medium", "low"]) {
      expect(
        classify(
          "repository_advisory",
          event({
            action: "reported",
            repository_advisory: report({ severity }),
          }),
          ME,
        ),
      ).toMatchObject({ signal: { severity } });
    }
  });

  it("tick a report once its advisory is published", () => {
    expect(
      classify(
        "repository_advisory",
        event({ action: "published", repository_advisory: report() }),
        ME,
      ),
    ).toEqual({ signal: { ...at, type: "advisory-published", ghsa: GHSA } });
  });

  it("drop an advisory without a proper id, and other actions", () => {
    for (const ghsa_id of [undefined, "", "CVE-2026-1234", `${GHSA}<b>`]) {
      expect(
        classify(
          "repository_advisory",
          event({
            action: "reported",
            repository_advisory: report({ ghsa_id }),
          }),
          ME,
        ),
      ).toEqual({ ignored: "an advisory without its id" });
    }
    expect(
      classify(
        "repository_advisory",
        event({ action: "updated", repository_advisory: report() }),
        ME,
      ),
    ).toEqual({ ignored: "an advisory updated" });
    expect(classify("repository_advisory", event({}), ME)).toEqual({
      ignored: "an advisory without its id",
    });
  });
});

describe("the rules of secret scanning", () => {
  const key = { ...at, key: "secret:3", number: 3, what: "Mailchimp API Key" };

  it("make an alert found, found again or found in public an entry, without the secret", () => {
    for (const action of ["created", "reopened"]) {
      const outcome = classify(
        "secret_scanning_alert",
        event({ action, alert: secretAlert() }),
        ME,
      );
      expect(outcome).toEqual({
        signal: {
          ...key,
          type: "secret-open",
          leaked: false,
          url: `https://github.com/${REPO}/security/secret-scanning/3`,
        },
      });
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    }
    expect(
      classify(
        "secret_scanning_alert",
        event({ action: "publicly_leaked", alert: secretAlert() }),
        ME,
      ),
    ).toMatchObject({ signal: { type: "secret-open", leaked: true } });
    expect(
      classify(
        "secret_scanning_alert",
        event({
          action: "created",
          alert: secretAlert({ publicly_leaked: true }),
        }),
        ME,
      ),
    ).toMatchObject({ signal: { type: "secret-open", leaked: true } });
  });

  it("name a secret by its kind where it has no name in words, and an alert without fields as it comes", () => {
    expect(
      classify(
        "secret_scanning_alert",
        event({
          action: "created",
          alert: secretAlert({ secret_type_display_name: null }),
        }),
        ME,
      ),
    ).toMatchObject({ signal: { what: "mailchimp_api_key" } });
    expect(
      classify("secret_scanning_alert", event({ action: "created" }), ME),
    ).toEqual({
      signal: {
        ...at,
        type: "secret-open",
        key: "secret:0",
        number: 0,
        what: "",
        leaked: false,
        url: "",
      },
    });
  });

  it("take a resolved alert out, and drop a resolved one found in public and other actions", () => {
    expect(
      classify(
        "secret_scanning_alert",
        event({
          action: "resolved",
          alert: secretAlert({ resolution: "revoked" }),
        }),
        ME,
      ),
    ).toEqual({ signal: { ...at, type: "alert-closed", key: "secret:3" } });
    expect(
      classify(
        "secret_scanning_alert",
        event({
          action: "publicly_leaked",
          alert: secretAlert({ resolution: "revoked" }),
        }),
        ME,
      ),
    ).toEqual({ ignored: "a secret alert that was resolved" });
    for (const action of ["validated", "assigned", undefined]) {
      expect(
        classify(
          "secret_scanning_alert",
          event({ action, alert: secretAlert() }),
          ME,
        ),
      ).toEqual({ ignored: `a secret alert ${action ?? ""}` });
    }
  });

  it("classify any payload without an error", () => {
    const events = fc.constantFrom(
      "repository_advisory",
      "secret_scanning_alert",
    );
    fc.assert(
      fc.property(events, fc.object(), (name, extra) => {
        const outcome = classify(name, event(extra), ME);
        return "signal" in outcome || typeof outcome.ignored === "string";
      }),
    );
  });
});

describe("a vulnerability report", () => {
  it("is a thing of its own in a topic, with its days and the buttons Later and Ignore", async () => {
    const w = await security();
    expect(await apply(w.context, reported)).toBe("advisory shown");
    expect(w.net.telegram("createForumTopic").map((call) => call.body)).toEqual(
      [
        {
          chat_id: CHAT,
          name: "🔐 Vulnerability report in demo",
          icon_color: TOPIC_COLORS.red,
        },
      ],
    );
    const [message] = sent(w);
    expect(message.text).toBe(
      `🔐 <b>Vulnerability report in <a href="https://github.com/${REPO}">${REPO}</a></b>\n` +
        `<a href="${ADVISORY}">${GHSA}</a> · severity: high\n` +
        "📅 Acknowledge it by 2026-11-11 and assess it by 2026-11-18, as SECURITY.md promises. What it says stays on GitHub until it is published.",
    );
    expect(
      message.reply_markup.inline_keyboard
        .flat()
        .map((b: { text: string }) => b.text),
    ).toEqual(["⏰ Later", "✖ Ignore"]);
    expect(await advisory(w)).toMatchObject({
      state: "open",
      ghsa: GHSA,
      severity: "high",
      reported: START,
      remindAt: START + 6 * DAY,
    });
    // The same report again shows nothing new.
    expect(await apply(w.context, reported)).toBe("advisory shown already");
    expect(sent(w)).toHaveLength(1);
  });

  it("speaks German, and says when no one rated it yet", async () => {
    const w = await security("de");
    await apply(w.context, { ...reported, severity: null });
    expect(w.net.telegram("createForumTopic")[0]?.body.name).toBe(
      "🔐 Sicherheitslücke gemeldet in demo",
    );
    expect(sent(w)[0].text).toContain(
      "· Schweregrad: noch nicht eingestuft\n📅 Bestätige sie bis 11.11.2026 und bewerte sie bis 18.11.2026",
    );
  });

  it("counts its days from its arrival when GitHub names none, and reminds of none that came too late", async () => {
    const w = await security();
    w.clock.now = START + DAY;
    await apply(w.context, { ...reported, reported: null });
    expect(await advisory(w)).toMatchObject({
      reported: START + DAY,
      remindAt: START + 7 * DAY,
    });
    const late = await security();
    late.clock.now = START + 6 * DAY;
    await apply(late.context, reported);
    expect((await advisory(late)).remindAt).toBeUndefined();
    expect(
      (await late.context.store.pending(late.clock.now, 0)).remind,
    ).toEqual([]);
  });

  it("is ticked once its advisory is published, without buttons", async () => {
    const w = await security();
    const published: Signal = { ...at, type: "advisory-published", ghsa: GHSA };
    expect(await apply(w.context, published)).toBe(
      "an advisory that the pager never showed",
    );
    await apply(w.context, reported);
    expect(await apply(w.context, published)).toBe("advisory published");
    const edit = w.net.telegram("editMessageText").at(-1)?.body;
    expect(edit.text).toMatch(/· severity: high\n✅ Published\.$/);
    expect(edit.reply_markup.inline_keyboard).toEqual([]);
    expect(w.net.telegram("editForumTopic").at(-1)?.body.name).toBe(
      "✅ 🔐 Vulnerability report in demo",
    );
    const item = await advisory(w);
    expect(item.state).toBe("published");
    expect(item.remindAt).toBeUndefined();
    expect(await apply(w.context, published)).toBe(
      "advisory published already",
    );
  });

  it("takes Later and Ignore, and shows neither its days nor buttons once ignored", async () => {
    const w = await security();
    await apply(w.context, reported);
    const item = await advisory(w);
    expect(allowed(item)).toEqual(["later", "ignore"]);
    await press(w.context, item, {
      action: "ignore",
      id: item.id,
      version: null,
    });
    const ignored = await advisory(w);
    expect(ignored.state).toBe("ignored");
    expect(allowed(ignored)).toEqual([]);
    expect(keyboard(ignored, texts("en"))).toEqual([]);
    const edit = w.net.telegram("editMessageText").at(-1)?.body;
    expect(edit.text).toMatch(/· severity: high\n✖ Ignored\.$/);
    // An ignored report keeps no mark for the schedule: its record expires.
    expect((await w.context.store.pending(START + 30 * DAY, 0)).remind).toEqual(
      [],
    );
  });

  it("tells the control repository its id and link alone", async () => {
    const w = await security();
    await apply(w.context, reported);
    const told = about(await advisory(w), START, texts("en"));
    expect(told).toMatchObject({ kind: "advisory", links: [ADVISORY] });
    expect(told.text).toContain(GHSA);
  });
});

describe("the reminder of a vulnerability report", () => {
  async function due(state: string | null, status = 200): Promise<World> {
    const w = await security();
    await apply(w.context, reported);
    w.net.on("GET", STATE, () =>
      json(
        state === null
          ? { message: "Resource not accessible by integration" }
          : { ...report(), state },
        status,
      ),
    );
    w.clock.now = START + 6 * DAY;
    return w;
  }

  it("comes once, as a new message, while the report waits in triage", async () => {
    const w = await due("triage");
    const id = (await advisory(w)).id;
    w.clock.now = START + 6 * DAY - 1;
    expect(await runSchedule(w.context)).toEqual([]);
    w.clock.now = START + 6 * DAY;
    expect(await runSchedule(w.context)).toEqual([id]);
    const message = sent(w).at(-1);
    expect(message.text).toContain(
      "\n<i>⏰ Still in triage on GitHub: acknowledge it by 2026-11-11, as SECURITY.md promises.</i>",
    );
    expect(message.message_thread_id).toBe(900);
    expect(w.net.telegram("deleteMessage")).toHaveLength(1);
    expect(w.net.github("/access_tokens").at(-1)?.body.permissions).toEqual({
      repository_advisories: "read",
    });
    expect((await advisory(w)).remindAt).toBeUndefined();
    expect(await runSchedule(w.context)).toEqual([]);
    expect(w.net.github(STATE)).toHaveLength(1);
  });

  it("comes too when GitHub doesn't tell the app the state", async () => {
    const w = await due(null, 403);
    expect(await runSchedule(w.context)).toHaveLength(1);
    expect(logs.join("\n")).toContain(
      `The state of ${GHSA} of ${REPO}: GitHub answered 403: Resource not accessible by integration`,
    );
    const network = await due("triage");
    network.net.on("GET", STATE, () => {
      throw new TypeError("network down");
    });
    expect(await runSchedule(network.context)).toHaveLength(1);
    const missing = await due("triage");
    missing.net.on("GET", STATE, () => json({}));
    expect(await runSchedule(missing.context)).toHaveLength(1);
  });

  it("stays away once the report was accepted, and shows what else GitHub did with it", async () => {
    const accepted = await due("draft");
    const calls = accepted.net.telegram("sendMessage").length;
    expect(await runSchedule(accepted.context)).toEqual([]);
    expect(accepted.net.telegram("sendMessage")).toHaveLength(calls);
    expect(await advisory(accepted)).toMatchObject({ state: "open" });
    expect((await advisory(accepted)).remindAt).toBeUndefined();

    for (const state of ["closed", "withdrawn"]) {
      const w = await due(state);
      expect(await runSchedule(w.context)).toEqual([]);
      expect(await advisory(w)).toMatchObject({
        state: "done",
        note: "Closed on GitHub.",
      });
      expect(w.net.telegram("editMessageText").at(-1)?.body.text).toMatch(
        /✅ Done\.\n<i>Closed on GitHub\.<\/i>$/,
      );
    }
    const published = await due("published");
    expect(await runSchedule(published.context)).toEqual([]);
    expect(await advisory(published)).toMatchObject({ state: "published" });
  });

  it("waits for the next run when a report came back from Later in this one, or no call is left", async () => {
    const w = await due("triage");
    const item = await advisory(w);
    item.snoozedUntil = START + 6 * DAY;
    await w.context.store.put(item);
    expect(await runSchedule(w.context)).toEqual([item.id]);
    expect(w.net.github(STATE)).toHaveLength(0);
    expect(await runSchedule(w.context)).toEqual([item.id]);
    expect(w.net.github(STATE)).toHaveLength(1);

    const busy = await due("triage");
    busy.context.subrequests = () => SUBREQUESTS - REMINDER_CALLS + 1;
    expect(
      await remindAdvisories(busy.context, [(await advisory(busy)).id]),
    ).toEqual([]);
    expect((await advisory(busy)).remindAt).toBe(START + 6 * DAY);
  });

  it("looks at its record, which the list may lag behind", async () => {
    const w = await due("triage");
    const item = await advisory(w);
    await apply(w.context, secret(1));
    expect(
      await remindAdvisories(w.context, [
        "i000000000000000",
        (await bundle(w)).id,
      ]),
    ).toEqual([]);
    for (const changed of [
      { ...item, remindAt: START + 7 * DAY },
      (({ remindAt: _remindAt, ...rest }) => rest)(item),
      { ...item, state: "ignored" as const },
    ]) {
      await w.context.store.put(changed);
      expect(await remindAdvisories(w.context, [item.id])).toEqual([]);
    }
    expect(w.net.github(STATE)).toHaveLength(0);
  });
});

describe("the security message of a repository", () => {
  it("lists a secret by its kind and its file, and offers no fix for secrets alone", async () => {
    const w = await security();
    expect(await apply(w.context, secret(3))).toBe("alert opened");
    expect(w.net.telegram("createForumTopic")[0]?.body.name).toBe(
      "🛡 Security in demo",
    );
    expect(sent(w)[0].text).toBe(
      `🛡 <b>Security in ${REPO}</b>\n` +
        `• <a href="https://github.com/${REPO}/security/secret-scanning/3">🔑 Mailchimp API Key in config/.env</a>`,
    );
    expect(w.net.github("/access_tokens")[0]?.body.permissions).toEqual({
      secret_scanning_alerts: "read",
    });
    expect(allowed(await bundle(w))).toEqual(["later", "ignore"]);
    // Code scanning in the same message brings 🛠 Start fix back.
    await apply(w.context, {
      ...at,
      type: "alert-open",
      key: "alert:4",
      label: {
        key: "entry.alertAt",
        values: { severity: "high", what: "XSS", path: "src/a.ts" },
      },
      url: `https://github.com/${REPO}/security/code-scanning/4`,
    });
    expect(allowed(await bundle(w))).toEqual(["fix", "later", "ignore"]);
  });

  it("says when a secret leaked in public too, and takes a resolved one out", async () => {
    const w = await security();
    await apply(w.context, secret(3));
    expect(await apply(w.context, secret(3, true))).toBe("alert updated");
    expect((await bundle(w)).entries[0]?.label).toBe(
      "🔑 Mailchimp API Key in config/.env, leaked in public too",
    );
    expect(
      await apply(w.context, { ...at, type: "alert-closed", key: "secret:3" }),
    ).toBe("alert closed");
    expect(await bundle(w)).toMatchObject({ state: "resolved", entries: [] });
  });

  it("lists a secret without a file where it was found elsewhere, or GitHub doesn't say", async () => {
    const w = await security("de");
    w.net.on("GET", /\/alerts\/5\/locations\?per_page=1$/, () =>
      json([{ type: "issue_body", details: { issue_body_url: "x" } }]),
    );
    w.net.on("GET", /\/alerts\/6\/locations\?per_page=1$/, () => json([]));
    w.net.on("GET", /\/alerts\/7\/locations\?per_page=1$/, () =>
      json({ message: "Resource not accessible by integration" }, 403),
    );
    w.net.on("GET", /\/alerts\/8\/locations\?per_page=1$/, () =>
      json([{ type: "wiki_commit", details: { path: "Home.md" } }]),
    );
    await apply(w.context, secret(5));
    await apply(w.context, secret(6, true));
    await apply(w.context, secret(7));
    await apply(w.context, secret(8, true));
    expect((await bundle(w)).entries.map((entry) => entry.label)).toEqual([
      "🔑 Mailchimp API Key",
      "🔑 Mailchimp API Key, auch öffentlich geleakt",
      "🔑 Mailchimp API Key",
      "🔑 Mailchimp API Key in Home.md, auch öffentlich geleakt",
    ]);
    expect(logs.join("\n")).toContain(
      `The place of secret alert 7 of ${REPO}: GitHub answered 403`,
    );
  });

  it("fails an event whose place GitHub can't be asked for, so that it comes again", async () => {
    const w = await security();
    w.net.on("GET", LOCATIONS, () => {
      throw new TypeError("network down");
    });
    await expect(apply(w.context, secret(3))).rejects.toThrow("network down");
    expect(await bundle(w)).toBeNull();
  });
});

describe("what a report says and a secret", () => {
  async function secrets(): Promise<PagerEnv> {
    return {
      ...(env as PagerEnv),
      TELEGRAM_BOT_TOKEN: "123:test",
      TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
      TELEGRAM_CHAT_ID: String(CHAT),
      GITHUB_WEBHOOK_SECRET: "github-secret",
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: (await appKey()).pem,
      CONTROL_SECRET: "control-secret",
    };
  }

  async function deliver(name: string, payload: unknown): Promise<string> {
    const body = JSON.stringify(payload);
    const response = await worker.fetch(
      new Request("https://pager.example/github", {
        method: "POST",
        headers: {
          "x-github-event": name,
          "x-hub-signature-256": `sha256=${await hmacHex("github-secret", body)}`,
        },
        body,
      }) as Request<unknown, IncomingRequestCfProperties>,
      await secrets(),
    );
    return response.text();
  }

  it("reach no message, no answer to GitHub, no record and no log", async () => {
    forget();
    const listed = await env.PAGER.list();
    await Promise.all(listed.keys.map((each) => env.PAGER.delete(each.name)));
    const net = withTopics(new Net());
    net.on("GET", LOCATIONS, () =>
      json([{ type: "commit", details: { path: "config/.env" } }]),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(net.fetch);
    const answers = [
      await deliver(
        "repository_advisory",
        event({ action: "reported", repository_advisory: report() }),
      ),
      await deliver(
        "repository_advisory",
        event({ action: "reported", repository_advisory: report() }),
      ),
      await deliver(
        "secret_scanning_alert",
        event({ action: "created", alert: secretAlert() }),
      ),
      await deliver(
        "secret_scanning_alert",
        event({ action: "validated", alert: secretAlert() }),
      ),
      await deliver(
        "repository_advisory",
        event({ action: "published", repository_advisory: report() }),
      ),
    ];
    expect(answers).toEqual([
      "advisory shown",
      "advisory shown already",
      "alert opened",
      "ignored: a secret alert validated",
      "advisory published",
    ]);
    const records = await Promise.all(
      (await env.PAGER.list()).keys.map((each) => env.PAGER.get(each.name)),
    );
    const everything = [
      ...answers,
      ...logs,
      ...records.map(String),
      ...net.calls.map((call) => `${call.url} ${JSON.stringify(call.body)}`),
    ].join("\n");
    expect(everything).toContain(GHSA);
    expect(everything).toContain("Mailchimp API Key in config/.env");
    for (const word of ["Remote code", "crafted", SECRET, "THESECRET"]) {
      expect(everything).not.toContain(word);
    }
  });
});
