// The health of the pager, which the control repository asks for once a day: when
// the schedule last ran to its end and what last failed in it, whether Telegram and GitHub take its secrets,
// whether the webhook of Telegram delivers, and the days of the tokens; signed, as
// every body of the control repository, and without a secret in the answer.
import { describe, expect, it, vi } from "vitest";

import { Memory } from "../src/context.ts";
import { handleControl } from "../src/control.ts";
import { hmacHex } from "../src/crypto.ts";
import { type Health, health, MAX_ERROR, RAN } from "../src/health.ts";
import { runSchedule } from "../src/schedule.ts";
import { TOKENS, type Tokens } from "../src/tokens.ts";
import { appKey, json, START, type World, world } from "./helpers.ts";

const APP = { slug: "repo-pager", owner: { login: "Dennis-Otto" } };

async function ask(
  w: World,
  secret = "control-secret",
): Promise<{ status: number; text: string }> {
  const body = JSON.stringify({ type: "health" });
  const stamp = String(START / 1000);
  const response = await handleControl(
    w.context,
    new Request("https://pager.example/control", {
      method: "POST",
      headers: {
        "x-pager-timestamp": stamp,
        "x-pager-signature": `sha256=${await hmacHex(secret, `${stamp}.${body}`)}`,
      },
      body,
    }),
  );
  return { status: response.status, text: await response.text() };
}

async function healthOf(w: World): Promise<Health> {
  const { status, text } = await ask(w);
  expect(status).toBe(200);
  return JSON.parse(text) as Health;
}

describe("the health of the pager", () => {
  it("says when the schedule last ran, that Telegram and GitHub take its secrets, and the days of the tokens", async () => {
    const w = await world({ tokenExpires: "2027-10-07" });
    w.net
      .on("GET", "/app", () => json(APP))
      .on("POST", /\/getWebhookInfo$/, () =>
        json({
          ok: true,
          result: {
            url: "https://pager.example/telegram",
            pending_update_count: 2,
            last_error_date: START / 1000 - 3600,
            last_error_message:
              "Wrong response from the webhook: 502 Bad Gateway",
          },
        }),
      );
    await w.context.local.put<Tokens>(TOKENS, {
      fix: { expires: "2026-11-30" },
    });
    w.clock.now = START - 15 * 60 * 1000;
    await runSchedule(w.context);
    w.clock.now = START;
    const answer = await healthOf(w);
    expect(answer).toEqual({
      schedule: "2026-11-04T07:45:00.000Z",
      failure: null,
      telegram: {
        ok: true,
        webhook: true,
        pending: 2,
        lastError: {
          at: "2026-11-04T07:00:00.000Z",
          message: "Wrong response from the webhook: 502 Bad Gateway",
        },
      },
      github: { ok: true },
      tokens: {
        claude: { expires: "2027-10-07" },
        user: { expires: null },
        fix: { expires: "2026-11-30" },
      },
    });
    const text = JSON.stringify(answer);
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
    // It changes nothing and sends nothing to the chat.
    expect(w.net.telegram("sendMessage")).toHaveLength(0);
  });

  it("says that the schedule never ran, and what Telegram and GitHub refused", async () => {
    const w = await world({ userToken: null });
    w.net
      .on("POST", /\/getMe$/, () =>
        json({ ok: false, error_code: 401, description: "Unauthorized" }, 401),
      )
      .on("GET", "/app", () =>
        json({ message: "A JSON web token could not be decoded" }, 401),
      );
    expect(await healthOf(w)).toEqual({
      schedule: null,
      failure: null,
      telegram: { ok: false, error: "Telegram getMe: Unauthorized" },
      github: {
        ok: false,
        error: "GitHub answered 401: A JSON web token could not be decoded",
      },
      tokens: {},
    });
  });

  it("says that no webhook is set, and keeps a long error short", async () => {
    const w = await world();
    const long = "x".repeat(MAX_ERROR + 50);
    w.net.on("POST", /\/getWebhookInfo$/, () =>
      json({ ok: true, result: { url: "", last_error_date: START / 1000 } }),
    );
    w.net.on("GET", "/app", () => json({ message: long }, 500));
    const answer = await healthOf(w);
    expect(answer.telegram).toEqual({
      ok: true,
      webhook: false,
      pending: 0,
      lastError: { at: "2026-11-04T08:00:00.000Z", message: "" },
    });
    expect(answer.github).toEqual({
      ok: false,
      error: `GitHub answered 500: ${long}`.slice(0, MAX_ERROR),
    });

    const odd = await world();
    odd.net.on("POST", /\/getWebhookInfo$/, () =>
      json({ ok: true, result: null }),
    );
    expect((await healthOf(odd)).telegram).toEqual({
      ok: true,
      webhook: false,
      pending: 0,
    });
    const odder = await world();
    odder.net.on("POST", /\/getWebhookInfo$/, () =>
      json({
        ok: true,
        result: {
          url: "https://pager.example/telegram",
          pending_update_count: 1.5,
          last_error_date: START / 1000,
          last_error_message: long,
        },
      }),
    );
    const telegram = (await healthOf(odder)).telegram;
    expect(telegram).toMatchObject({ ok: true, webhook: true, pending: 0 });
    expect(
      "lastError" in telegram ? telegram.lastError?.message : undefined,
    ).toBe(long.slice(0, MAX_ERROR));
  });

  it("names only the kind of an error that isn't an answer of an API", async () => {
    const w = await world();
    w.net.on("POST", /\/getMe$/, () => {
      throw new TypeError("https://api.telegram.org/bot123:test/getMe failed");
    });
    const answer = await healthOf(w);
    expect(answer.telegram).toEqual({ ok: false, error: "TypeError" });
    expect(JSON.stringify(answer)).not.toContain("123:test");
  });

  it("is told only to the control repository", async () => {
    const w = await world();
    expect(await ask(w, "wrong-secret")).toEqual({
      status: 401,
      text: "Unauthorized",
    });
    expect(w.net.calls).toEqual([]);
  });

  it("notes the time of a run of the schedule only when nothing failed in it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world();
    w.net.on("GET", "/app/hook/deliveries?per_page=100", () => {
      throw new TypeError("Network connection lost");
    });
    expect(await runSchedule(w.context)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      "The schedule failed at the events that failed:",
      "TypeError",
    );
    expect(await w.context.local.get(RAN)).toBeUndefined();
    expect((await health(w.context)).failure).toEqual({
      at: "2026-11-04T08:00:00.000Z",
      what: "the events that failed",
      error: "TypeError",
    });
  });
});

describe("the storage outside the Durable Object", () => {
  it("hands out copies, as the storage of a Durable Object does", async () => {
    const local = new Memory();
    expect(await local.get("tokens")).toBeUndefined();
    const value = { fix: { expires: "2026-11-30" } };
    await local.put("tokens", value);
    value.fix.expires = "changed";
    const read = await local.get<typeof value>("tokens");
    expect(read).toEqual({ fix: { expires: "2026-11-30" } });
    (read as typeof value).fix.expires = "changed again";
    expect(await local.get("tokens")).toEqual({
      fix: { expires: "2026-11-30" },
    });
  });
});
