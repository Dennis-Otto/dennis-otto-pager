// The Worker as Cloudflare runs it: its routes, the proof that each request brings,
// and the schedule. Its secrets come from the test, as Cloudflare would set them;
// its calls go to the simulated network.
import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describe as describeError, makeContext } from "../src/context.ts";
import { hmacHex } from "../src/crypto.ts";
import { forget, GitHubError } from "../src/github.ts";
import worker from "../src/index.ts";
import { html } from "../src/render.ts";
import { schedule } from "../src/routes.ts";
import type { PagerEnv } from "../src/settings.ts";
import { type Contribution, itemId, keys } from "../src/store.ts";
import { TelegramError } from "../src/telegram.ts";
import { languageOf, texts } from "../src/texts.ts";
import { appKey, base, CHAT, json, Net, REPO, settings } from "./helpers.ts";

/** The texts of the language that wrangler.jsonc sets. */
const say = texts(languageOf((env as PagerEnv).LANGUAGE) ?? "en");

/**
 * The maintainer and the control repository that wrangler.jsonc sets, and a
 * repository of that maintainer. The Worker under test serves only the
 * repositories of its maintainer, and every copy sets its own in wrangler.jsonc,
 * as docs/setup.md asks: the tests take them from there, and
 * scripts/check-project.sh runs them once more with those of another instance.
 */
const { MAINTAINER_LOGIN: OWNER, CONTROL_REPOSITORY: CONTROL } =
  env as PagerEnv;
const HERE = `${OWNER}/demo`;

let net: Net;
let errors: string[];

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

async function call(
  request: Request,
  environment?: PagerEnv,
): Promise<Response> {
  return worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    environment ?? (await secrets()),
  );
}

function post(
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://pager.example${path}`, {
    method: "POST",
    headers,
    body,
  });
}

async function fromGitHub(
  event: string,
  payload: unknown,
  secret = "github-secret",
) {
  const body = JSON.stringify(payload);
  return post("/github", body, {
    "x-github-event": event,
    "x-hub-signature-256": `sha256=${await hmacHex(secret, body)}`,
  });
}

beforeEach(async () => {
  forget();
  const listed = await env.PAGER.list();
  await Promise.all(listed.keys.map((each) => env.PAGER.delete(each.name)));
  net = new Net();
  errors = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(net.fetch);
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the routes", () => {
  it("answer a health check and nothing else without a POST", async () => {
    expect(
      await (await exports.default.fetch("https://pager.example/")).text(),
    ).toBe("ok");
    expect(
      (await exports.default.fetch("https://pager.example/admin")).status,
    ).toBe(404);
    const get = await exports.default.fetch("https://pager.example/github");
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("serve nothing while a secret is missing, and name it in the log only", async () => {
    const response = await exports.default.fetch(post("/telegram", "{}"));
    expect(response.status).toBe(503);
    expect(errors[0]).toContain("TELEGRAM_BOT_TOKEN");
    expect(await response.text()).toBe("Service Unavailable");
  });
});

describe("the webhook of Telegram", () => {
  const update = JSON.stringify({
    message: {
      message_id: 1,
      chat: { id: CHAT },
      from: { id: CHAT },
      text: "/help",
    },
  });

  it("needs the secret header of setWebhook", async () => {
    expect((await call(post("/telegram", update))).status).toBe(401);
    const wrong = { "x-telegram-bot-api-secret-token": "guess" };
    expect((await call(post("/telegram", update, wrong))).status).toBe(401);
    expect(net.calls).toHaveLength(0);
  });

  it("handles an update and refuses one that isn't JSON", async () => {
    const header = { "x-telegram-bot-api-secret-token": "telegram-secret" };
    expect(await (await call(post("/telegram", update, header))).text()).toBe(
      "ok",
    );
    expect(net.telegram("sendMessage")).toHaveLength(1);
    expect((await call(post("/telegram", "{", header))).status).toBe(400);
  });

  it("logs a failed update without its text, and still takes it", async () => {
    net.on("POST", /sendMessage$/, () =>
      json({ ok: false, description: "Forbidden" }, 403),
    );
    const header = { "x-telegram-bot-api-secret-token": "telegram-secret" };
    expect((await call(post("/telegram", update, header))).status).toBe(200);
    expect(errors).toEqual([
      "A Telegram update failed: Telegram sendMessage: Forbidden",
    ]);
  });
});

describe("the webhook of GitHub", () => {
  const repository = {
    full_name: HERE,
    default_branch: "main",
    owner: { login: OWNER },
  };
  const opened = {
    action: "opened",
    installation: { id: 9 },
    repository,
    issue: {
      number: 12,
      title: "Hi",
      html_url: "https://github.com/x",
      user: { login: "octocat" },
    },
  };

  it("needs the signature of the app's secret", async () => {
    expect(
      (await call(await fromGitHub("issues", opened, "wrong"))).status,
    ).toBe(401);
    expect(
      (await call(post("/github", "{}", { "x-github-event": "issues" })))
        .status,
    ).toBe(401);
  });

  it("answers a ping, refuses what isn't JSON and says why it ignored an event", async () => {
    expect(
      await (
        await call(await fromGitHub("ping", { zen: "Keep it simple" }))
      ).text(),
    ).toBe("pong");
    const broken = post("/github", "{", {
      "x-github-event": "issues",
      "x-hub-signature-256": `sha256=${await hmacHex("github-secret", "{")}`,
    });
    expect((await call(broken)).status).toBe(400);
    const edited = { ...opened, action: "edited" };
    expect(await (await call(await fromGitHub("issues", edited))).text()).toBe(
      "ignored: an issue edited",
    );
    const nameless = await fromGitHub("issues", edited);
    nameless.headers.delete("x-github-event");
    expect(await (await call(nameless)).text()).toBe("ignored: the event ");
  });

  it("pages for what counts, in the language of wrangler.jsonc", async () => {
    const response = await call(await fromGitHub("issues", opened));
    expect(await response.text()).toBe("contribution shown");
    const sent = net.telegram("sendMessage")[0]?.body;
    expect(sent.text).toContain(
      say("message.issue", { repo: HERE, author: "", link: "" }).split(
        ` ${HERE}`,
      )[0],
    );
    expect(sent.reply_markup.inline_keyboard[0][0].text).toBe(
      say("button.draft"),
    );
  });

  it("follows the comments of a contribution, and takes the same delivery twice once", async () => {
    await call(await fromGitHub("issues", opened));
    const commented = {
      action: "created",
      installation: { id: 9 },
      repository,
      issue: opened.issue,
      comment: {
        id: 99,
        html_url: "https://github.com/x#issuecomment-99",
        user: { login: "hubot" },
      },
    };
    const first = await call(await fromGitHub("issue_comment", commented));
    expect(await first.text()).toBe("comment shown in place");
    // GitHub delivers an event again when its answer was lost.
    const again = await call(await fromGitHub("issue_comment", commented));
    expect(await again.text()).toBe("comment shown already");
    expect(net.telegram("editMessageText")).toHaveLength(1);
    expect(net.telegram("sendMessage")).toHaveLength(2);
    const replied = {
      ...commented,
      comment: { id: 100, user: { login: OWNER } },
    };
    expect(
      await (await call(await fromGitHub("issue_comment", replied))).text(),
    ).toBe("contribution done: replied");
  });

  it("answers 500 when it failed, so that GitHub can deliver it again", async () => {
    const run = {
      action: "completed",
      installation: { id: 9 },
      repository,
      check_run: {
        name: "lint",
        conclusion: "failure",
        check_suite: { head_branch: "main" },
      },
    };
    net.on("GET", /rules\/branches\/main$/, () =>
      json({ message: "Boom" }, 502),
    );
    expect((await call(await fromGitHub("check_run", run))).status).toBe(500);
    expect(errors).toEqual([
      "A GitHub check_run failed: GitHub answered 502: Boom",
    ]);
  });
});

describe("one change at a time", () => {
  const repository = {
    full_name: HERE,
    default_branch: "main",
    owner: { login: OWNER },
  };

  function failed(name: string) {
    return {
      action: "completed",
      installation: { id: 9 },
      repository,
      check_run: {
        name,
        conclusion: "failure",
        html_url: `https://github.com/${HERE}/runs/${name}`,
        check_suite: { head_branch: "main" },
      },
    };
  }

  it("bundles two required checks that fail at the same moment into one message", async () => {
    net.on("GET", /rules\/branches\/main$/, () =>
      json([
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "lint" }, { context: "test" }],
          },
        },
      ]),
    );
    const answers = await Promise.all([
      call(await fromGitHub("check_run", failed("lint"))),
      call(await fromGitHub("check_run", failed("test"))),
    ]);
    expect(await Promise.all(answers.map((each) => each.text()))).toEqual([
      "alarm opened",
      "new entry in the alarm, quietly",
    ]);
    expect(net.telegram("sendMessage")).toHaveLength(1);
    const store = makeContext(await settings(), env as PagerEnv).store;
    const bundle = await store.get(await itemId(keys.alarm(HERE)));
    expect(bundle).toMatchObject({
      entries: [{ key: "check:lint" }, { key: "check:test" }],
    });
  });

  it("posts a draft once when Send is pressed twice", async () => {
    net.on("POST", "/repos/Dennis-Otto/demo/issues/12/comments", () =>
      json({ html_url: "https://github.com/c" }, 201),
    );
    const id = await itemId(keys.contribution(REPO, 12));
    const drafted: Contribution = {
      ...base(id),
      kind: "contribution",
      state: "draft",
      number: 12,
      pull: false,
      title: "It breaks",
      url: "https://github.com/Dennis-Otto/demo/issues/12",
      author: "octocat",
      draft: "Thanks!",
      draftVersion: 1,
    };
    await makeContext(await settings(), env as PagerEnv).store.put(drafted);
    const environment = {
      ...(await secrets()),
      GITHUB_USER_TOKEN: "user-token",
    } as PagerEnv;
    const press = (query: string) =>
      call(
        post(
          "/telegram",
          JSON.stringify({
            callback_query: {
              id: query,
              from: { id: CHAT },
              data: `send:${id}:1`,
            },
          }),
          { "x-telegram-bot-api-secret-token": "telegram-secret" },
        ),
        environment,
      );
    await Promise.all([press("q1"), press("q2")]);
    expect(net.github("/comments")).toHaveLength(1);
  });

  it("goes on after a change that failed", async () => {
    net.on("GET", /rules\/branches\/main$/, () =>
      json({ message: "Boom" }, 502),
    );
    const answers = await Promise.all([
      call(await fromGitHub("check_run", failed("lint"))),
      call(
        await fromGitHub("issues", {
          action: "opened",
          installation: { id: 9 },
          repository,
          issue: {
            number: 12,
            title: "Hi",
            html_url: "https://github.com/x",
            user: { login: "octocat" },
          },
        }),
      ),
    ]);
    expect(answers.map((each) => each.status)).toEqual([500, 200]);
  });
});

describe("the route of the control repository", () => {
  it("is served by the control handler", async () => {
    const response = await call(post("/control", "{}"));
    expect(response.status).toBe(401);
  });
});

describe("the schedule", () => {
  it("runs with the settings, and only with them", async () => {
    const context = createExecutionContext();
    await worker.scheduled(
      createScheduledController(),
      env as PagerEnv,
      context,
    );
    expect(errors[0]).toContain("The pager misses settings");
    const environment = {
      ...(await secrets()),
      CLAUDE_TOKEN_EXPIRES: "2026-11-01",
    } as unknown as PagerEnv;
    const running = createExecutionContext();
    await worker.scheduled(createScheduledController(), environment, running);
    await waitOnExecutionContext(running);
    // The message is HTML: the quotes of the English text come escaped.
    expect(net.telegram("sendMessage")[0]?.body.text).toContain(
      html(
        say("reminder.expired", {
          repo: CONTROL,
          date: say.date("2026-11-01"),
        }),
        1000,
      ),
    );
  });

  it("notes its last run in the Durable Object, which the health of the pager answers", async () => {
    const running = createExecutionContext();
    await worker.scheduled(
      createScheduledController(),
      await secrets(),
      running,
    );
    await waitOnExecutionContext(running);
    const body = JSON.stringify({ type: "health" });
    const stamp = String(Math.floor(Date.now() / 1000));
    const response = await call(
      post("/control", body, {
        "x-pager-timestamp": stamp,
        "x-pager-signature": `sha256=${await hmacHex("control-secret", `${stamp}.${body}`)}`,
      }),
    );
    expect(response.status).toBe(200);
    const answer = await response.json<{ schedule: string | null }>();
    expect(Date.parse(String(answer.schedule))).toBeGreaterThan(
      Date.now() - 60 * 1000,
    );
  });

  it("logs a thing that failed, and a run that failed", async () => {
    net.on("POST", /sendMessage$/, () =>
      json({ ok: false, description: "Forbidden" }, 403),
    );
    const environment = {
      ...(await secrets()),
      CLAUDE_TOKEN_EXPIRES: "2026-11-01",
    } as unknown as PagerEnv;
    const running = createExecutionContext();
    await worker.scheduled(createScheduledController(), environment, running);
    await waitOnExecutionContext(running);
    expect(errors).toEqual([
      "The schedule failed at the reminders of the tokens, the reminder of the claude token: Telegram sendMessage: Forbidden",
    ]);

    // Without the list of the things, the run can't start.
    errors = [];
    const context = makeContext(await settings(), env as PagerEnv, net.fetch);
    vi.spyOn(context.store, "pending").mockRejectedValueOnce(
      new TypeError("KV list failed"),
    );
    await schedule(context);
    expect(errors).toEqual(["The schedule failed: TypeError"]);
  });
});

describe("the context", () => {
  it("runs a change at once outside the Durable Object", async () => {
    const context = makeContext(await settings(), env as PagerEnv);
    expect(await context.exclusive(async () => "done")).toBe("done");
  });

  it("waits with a timer of the runtime", async () => {
    const context = makeContext(await settings(), env as PagerEnv);
    const before = Date.now();
    await context.sleep(5);
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });
});

describe("the log", () => {
  it("names the answers of the APIs, and of any other error only its kind", () => {
    expect(describeError(new GitHubError(404, "Not Found"))).toBe(
      "GitHub answered 404: Not Found",
    );
    expect(describeError(new TelegramError("sendMessage", "Forbidden"))).toBe(
      "Telegram sendMessage: Forbidden",
    );
    expect(describeError(new TypeError("token 123:secret in an address"))).toBe(
      "TypeError",
    );
    expect(describeError("text")).toBe("unknown error");
  });
});
