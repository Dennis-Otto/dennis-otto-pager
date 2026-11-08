// The events of GitHub that the pager failed to handle: each run of the schedule
// has GitHub deliver them again, three attempts in all, within the calls that the
// free plan of Workers allows, and an event whose attempts all failed is an entry
// of the alarm of the control repository. A redelivery may bring a signal that
// went through before its answer failed, so each signal applied twice leaves the
// state as it was after the first.
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowed } from "../src/buttons.ts";
import {
  ALARM_CHANGE,
  entryKey,
  failed,
  failedEvents,
  LOOK_BACK,
  MAX_REDELIVERIES,
  SUBREQUESTS,
} from "../src/deliveries.ts";
import type { Delivery } from "../src/github.ts";
import { apply } from "../src/pager.ts";
import type { Signal } from "../src/rules.ts";
import { runSchedule } from "../src/schedule.ts";
import { type Alarm, type Item, itemId, keys } from "../src/store.ts";
import {
  base,
  DELIVERIES,
  json,
  REPO,
  START,
  type World,
  withControl,
  withTopics,
  world,
} from "./helpers.ts";
import { artifact } from "./zips.ts";

const CONTROL = "Dennis-Otto/control";
const ADVANCED = "https://github.com/settings/apps/dennis-otto-pager/advanced";
const MINUTE = 60_000;
const ATTEMPTS = /\/app\/hook\/deliveries\/(\d+)\/attempts$/;

let serial = 0;

/** An attempt of the event guid, minutes before START; its id grows with its time. */
function attempt(
  guid: string,
  minutes: number,
  status: number,
  {
    redelivery = false,
    event = "pull_request",
    action = "opened" as string | null,
    repository = null as number | null,
  } = {},
): Delivery {
  serial += 1;
  return {
    id: 1_000_000_000 - minutes * 1000 + (serial % 1000),
    guid,
    delivered_at: new Date(START - minutes * MINUTE).toISOString(),
    redelivery,
    status_code: status,
    event,
    action,
    repository_id: repository,
  };
}

/** The three attempts of an event that failed each time, the newest 15 minutes ago. */
function exhausted(guid: string, event = "pull_request"): Delivery[] {
  return [
    attempt(guid, 15, 0, { redelivery: true, event }),
    attempt(guid, 30, 502, { redelivery: true, event }),
    attempt(guid, 45, 500, { event }),
  ];
}

/**
 * The simulated app: its webhook lists these pages of deliveries, newest first,
 * each with the cursor of the next in its Link header, GitHub takes each
 * redelivery, and the app is installed on the control repository.
 */
function listing(w: World, pages: Delivery[][]): World {
  pages.forEach((page, index) => {
    const url = index === 0 ? DELIVERIES : `${DELIVERIES}&cursor=c${index}`;
    const headers: Record<string, string> =
      index + 1 < pages.length
        ? {
            link: `<https://api.github.com/app/hook/deliveries?per_page=100&cursor=c${index - 1}>; rel="prev", <https://api.github.com/app/hook/deliveries?per_page=100&cursor=c${index + 1}>; rel="next"`,
          }
        : {};
    w.net.on("GET", url, () => Response.json(page, { headers }));
  });
  w.net
    .on("POST", ATTEMPTS, () => json({}, 202))
    .on("GET", /^https:\/\/api\.github\.com\/app$/, () =>
      json({
        slug: "dennis-otto-pager",
        owner: { login: "Dennis-Otto", type: "User" },
      }),
    );
  withControl(w.net);
  return w;
}

/** The ids of the deliveries that the pager had GitHub deliver again, in order. */
function redelivered(w: World): number[] {
  return w.net.calls.flatMap((call) => {
    const match = call.method === "POST" ? ATTEMPTS.exec(call.url) : null;
    return match === null ? [] : [Number(match[1])];
  });
}

async function theAlarm(w: World): Promise<Alarm | null> {
  return (await w.context.store.get(
    await itemId(keys.alarm(CONTROL)),
  )) as Alarm | null;
}

/** Count n more calls than the network saw, as if the steps before had made them. */
function spent(w: World, calls: number): void {
  const counted = w.context.subrequests;
  w.context.subrequests = () => counted() + calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an event that the pager failed to handle", () => {
  it("comes again after a 5xx or no answer in time, and never after a 2xx or a 4xx", async () => {
    const broken = attempt("broken", 20, 500);
    const timeout = attempt("timeout", 30, 0);
    const w = listing(await world(), [
      [attempt("passed", 5, 200), attempt("refused", 10, 401), broken, timeout],
    ]);
    expect(await runSchedule(w.context)).toEqual([]);
    // The oldest first.
    expect(redelivered(w)).toEqual([timeout.id, broken.id]);
    const posts = w.net.calls.filter((call) => call.method === "POST");
    expect(posts[0]?.headers.authorization).toMatch(/^Bearer ey/);
    expect(
      w.net.calls.filter((call) =>
        call.url.startsWith("https://api.telegram.org/"),
      ),
    ).toEqual([]);
    expect(await theAlarm(w)).toBeNull();
  });

  it("counts a 5xx and a missing answer as failed, and a refusal not", () => {
    expect(failed(attempt("a", 1, 0))).toBe(true);
    expect(failed(attempt("a", 1, 503))).toBe(true);
    expect(failed(attempt("a", 1, 422))).toBe(false);
    expect(failed(attempt("a", 1, 202))).toBe(false);
  });

  it("stops at three attempts, and pages once with the alarm of the control repository", async () => {
    const twice = [
      attempt("twice", 10, 500, { redelivery: true }),
      attempt("twice", 25, 500),
    ];
    const w = listing(await world(), [[...exhausted("thrice"), ...twice]]);
    withTopics(w.net);
    const id = await itemId(keys.alarm(CONTROL));
    expect(await runSchedule(w.context)).toEqual([id]);
    // The third attempt of the one that failed twice, none for the one that failed thrice.
    expect(redelivered(w)).toEqual([twice[0]?.id]);
    expect(await theAlarm(w)).toMatchObject({
      kind: "alarm",
      state: "open",
      repo: CONTROL,
      installation: 77,
      entries: [
        {
          key: entryKey("thrice"),
          label: "An event of GitHub fails: pull_request.opened",
          url: ADVANCED,
        },
      ],
    });
    const [message] = w.net.telegram("sendMessage");
    expect(message?.body.text).toContain(
      `<a href="${ADVANCED}">An event of GitHub fails: pull_request.opened</a>`,
    );
    // The next run pages no more, and reads no more of the app.
    expect(await runSchedule(w.context)).toEqual([]);
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    expect(w.net.telegram("editMessageText")).toHaveLength(0);
    expect(w.net.github("/app")).toHaveLength(1);
    // Claude can't fix an event that fails: its alarm offers no 🔧 Fix.
    expect(allowed((await theAlarm(w)) as Alarm)).toEqual(["later", "ignore"]);
    const mixed = (await theAlarm(w)) as Alarm;
    mixed.entries.push({ ...mixed.entries[0], key: "check:build" } as never);
    expect(allowed(mixed)).toEqual(["fix", "later", "ignore"]);
  });

  it("names the event without its action, and the page of an app of an organization", async () => {
    const w = listing(await world(), [
      exhausted("released", "release").map((each) => ({
        ...each,
        action: null,
      })),
    ]);
    w.net.on("GET", /^https:\/\/api\.github\.com\/app$/, () =>
      json({ slug: "pager", owner: { login: "acme", type: "Organization" } }),
    );
    await failedEvents(w.context);
    expect((await theAlarm(w))?.entries[0]).toMatchObject({
      label: "An event of GitHub fails: release",
      url: "https://github.com/organizations/acme/settings/apps/pager/advanced",
    });
  });

  it("joins an alarm of the control repository that is open, with its installation", async () => {
    const w = listing(await world(), [
      [...exhausted("thrice"), ...exhausted("again")],
    ]);
    await apply(w.context, {
      repo: CONTROL,
      installation: 78,
      type: "failing",
      key: "bot:1",
      label: { key: "entry.bot", values: { title: "A bot" } },
      url: "https://github.com/x",
    });
    await failedEvents(w.context);
    expect(w.net.github("/installation")).toHaveLength(0);
    expect((await theAlarm(w))?.entries.map((entry) => entry.key)).toEqual([
      "bot:1",
      entryKey("thrice"),
      entryKey("again"),
    ]);
    expect(w.net.github("/app")).toHaveLength(1);
    expect((await theAlarm(w))?.installation).toBe(78);
  });

  it("leaves an entry that was ignored as it is, and opens a new alarm for another event", async () => {
    const w = listing(await world(), [
      [...exhausted("thrice"), ...exhausted("again")],
    ]);
    const id = await itemId(keys.alarm(CONTROL));
    await w.context.store.put({
      ...base(id),
      repo: CONTROL,
      installation: 78,
      kind: "alarm",
      state: "ignored",
      entries: [{ key: entryKey("thrice"), label: "old", url: ADVANCED }],
    } as Item);
    expect(await failedEvents(w.context)).toEqual([id]);
    expect(await theAlarm(w)).toMatchObject({
      state: "open",
      installation: 78,
      entries: [{ key: entryKey("again") }],
    });
  });

  it("takes the entry out once a later attempt passes, such as one asked for on the Advanced page", async () => {
    const w = listing(await world(), [exhausted("thrice")]);
    await failedEvents(w.context);
    const id = await itemId(keys.alarm(CONTROL));
    // Four hours later, the maintainer had GitHub deliver it again, and it passed;
    // the attempts of an hour ago are gone from the list.
    w.clock.now = START + 4 * 60 * MINUTE;
    const later = listing(w, [
      [
        attempt("thrice", -239, 200, { redelivery: true }),
        attempt("other", -238, 200, { redelivery: true }),
      ],
    ]);
    expect(await failedEvents(later.context)).toEqual([id]);
    expect(await theAlarm(w)).toMatchObject({
      state: "recovered",
      entries: [],
    });
    expect(w.net.telegram("editMessageText")).toHaveLength(1);
    // A pass of an event that the alarm doesn't show changes nothing.
    expect(await failedEvents(later.context)).toEqual([]);
    expect(w.net.telegram("editMessageText")).toHaveLength(1);
  });

  it("keeps the entry of an alarm that is ignored, also once an attempt passes", async () => {
    const w = listing(await world(), [
      [
        { ...attempt("thrice", 1, 200, { redelivery: true }), id: 2e9 },
        attempt("refused", 2, 401, { redelivery: true }),
      ],
    ]);
    const id = await itemId(keys.alarm(CONTROL));
    const ignored = {
      ...base(id),
      repo: CONTROL,
      kind: "alarm",
      state: "ignored",
      entries: [{ key: entryKey("thrice"), label: "old", url: ADVANCED }],
    } as Item;
    await w.context.store.put(ignored);
    expect(await failedEvents(w.context)).toEqual([]);
    expect(await theAlarm(w)).toEqual(ignored);
  });

  it("asks for no alarm where the app isn't installed on the control repository", async () => {
    const w = listing(await world(), [exhausted("thrice")]);
    w.net.on("GET", `/repos/${CONTROL}/installation`, () =>
      json({ message: "Not Found" }, 404),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await failedEvents(w.context)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      `The GitHub App isn't installed on ${CONTROL}: no alarm for the events that fail`,
    );
    expect(await theAlarm(w)).toBeNull();
  });

  it("asks for ten at most per run, the oldest first", async () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      attempt(`event-${index}`, 10 + index, 500),
    );
    const w = listing(await world(), [many]);
    await failedEvents(w.context);
    expect(MAX_REDELIVERIES).toBe(10);
    expect(redelivered(w)).toEqual(
      many
        .slice(5)
        .map((each) => each.id)
        .reverse(),
    );
  });

  it("reads three pages at most, and back to three hours", async () => {
    const pages = [0, 1, 2, 3].map((page) => [
      attempt(`event-${page}`, 10 + page * 30, 500),
    ]);
    const w = listing(await world(), pages);
    await failedEvents(w.context);
    const read = w.net.calls.filter((call) => call.url.startsWith(DELIVERIES));
    expect(read.map((call) => call.url)).toEqual([
      DELIVERIES,
      `${DELIVERIES}&cursor=c1`,
      `${DELIVERIES}&cursor=c2`,
    ]);
    expect(redelivered(w)).toHaveLength(3);

    const old = listing(await world(), [
      [attempt("new", 10, 500), attempt("old", LOOK_BACK / MINUTE + 1, 500)],
      [attempt("older", LOOK_BACK / MINUTE + 30, 500)],
    ]);
    await failedEvents(old.context);
    expect(
      old.net.calls.filter((call) => call.url.startsWith(DELIVERIES)),
    ).toHaveLength(1);
    expect(redelivered(old)).toHaveLength(1);

    const empty = listing(await world(), [[], [attempt("next", 10, 500)]]);
    expect(await failedEvents(empty.context)).toEqual([]);
    expect(redelivered(empty)).toEqual([]);
  });

  it("gives no more attempts to an event whose first delivery is no longer on the pages", async () => {
    // Its first delivery is older than three hours, or on a page that wasn't read:
    // the attempts that the pages show aren't all that it had.
    const w = listing(await world(), [
      [
        attempt("cut", 20, 500, { redelivery: true }),
        attempt("cut", LOOK_BACK / MINUTE + 5, 500),
      ],
    ]);
    await failedEvents(w.context);
    expect(redelivered(w)).toEqual([]);
  });

  it("doesn't come again once a newer event of its kind and repository passed", async () => {
    // A late copy of a run, a check or a pull request would bring back an older
    // state, such as an alarm that a rerun ended, or a release at an old head.
    const stale = attempt("stale", 40, 500, {
      event: "workflow_run",
      repository: 1,
    });
    const newer = attempt("newer", 30, 200, {
      event: "workflow_run",
      repository: 1,
    });
    const elsewhere = attempt("elsewhere", 35, 500, {
      event: "workflow_run",
      repository: 2,
    });
    const comment = attempt("comment", 38, 500, {
      event: "issue_comment",
      repository: 1,
    });
    const later = attempt("later", 20, 200, {
      event: "issue_comment",
      repository: 1,
    });
    const before = attempt("before", 45, 200, {
      event: "pull_request",
      repository: 1,
    });
    const opened = attempt("opened", 42, 500, { repository: 1 });
    const failedToo = attempt("failed-too", 25, 500, {
      event: "check_run",
      repository: 1,
    });
    const check = attempt("check", 28, 502, {
      event: "check_run",
      repository: 1,
    });
    const w = listing(await world(), [
      [
        later,
        failedToo,
        check,
        newer,
        elsewhere,
        comment,
        opened,
        stale,
        before,
      ],
    ]);
    await failedEvents(w.context);
    // Not the stale run; a comment overtakes nothing, an older pass and one of
    // another repository don't count, and neither does a newer one that failed.
    expect(redelivered(w)).toEqual([
      opened.id,
      comment.id,
      elsewhere.id,
      check.id,
      failedToo.id,
    ]);
  });

  it("lets a newer alert of secret scanning overtake an older one, and never a report", async () => {
    // A late alert found would bring back one that was resolved since; a report
    // that comes again is shown once, and a report missed is a promise missed.
    const found = attempt("found", 40, 500, {
      event: "secret_scanning_alert",
      repository: 1,
    });
    const resolved = attempt("resolved", 30, 200, {
      event: "secret_scanning_alert",
      repository: 1,
    });
    const reported = attempt("reported", 38, 500, {
      event: "repository_advisory",
      repository: 1,
    });
    const published = attempt("published", 20, 200, {
      event: "repository_advisory",
      repository: 1,
    });
    const w = listing(await world(), [[published, resolved, reported, found]]);
    await failedEvents(w.context);
    expect(redelivered(w)).toEqual([reported.id]);
  });

  it("counts a passing redelivery of a newer event as newer, and of an older one not", async () => {
    const suite = (
      guid: string,
      minutes: number,
      status: number,
      again = false,
    ) =>
      attempt(guid, minutes, status, {
        redelivery: again,
        event: "check_suite",
        repository: 1,
      });
    const overtaken = listing(await world(), [
      [
        suite("newer", 10, 200, true),
        suite("newer", 30, 500),
        suite("stale", 40, 500),
      ],
    ]);
    await failedEvents(overtaken.context);
    expect(redelivered(overtaken)).toEqual([]);
    const stale = suite("stale", 40, 500);
    // An event of no repository: nothing overtakes it.
    const none = attempt("none", 55, 500, { event: "check_suite" });
    const kept = listing(await world(), [
      [
        suite("older", 12, 200, true),
        attempt("newest", 11, 200, { event: "check_suite" }),
        stale,
        suite("older", 50, 500),
        none,
      ],
    ]);
    await failedEvents(kept.context);
    expect(redelivered(kept)).toEqual([none.id, stale.id]);
  });

  it("takes the newest attempt by its id, whatever the order of the list", async () => {
    const first = attempt("event", 30, 200);
    const again = { ...attempt("event", 20, 500, { redelivery: true }) };
    const w = listing(await world(), [[first, again]]);
    await failedEvents(w.context);
    expect(redelivered(w)).toEqual([again.id]);
  });

  it("survives a 5xx of the deliveries API, and keeps the pages that it read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world({ tokenExpires: "2026-11-10" });
    listing(w, [[attempt("event", 10, 500)]]);
    w.net.on("GET", DELIVERIES, () => json({ message: "Server Error" }, 502));
    // The steps before it ran: the reminder of the token came.
    const reminder = await itemId(keys.reminder("claude-token:2026-11-10"));
    expect(await runSchedule(w.context)).toEqual([reminder]);
    expect(error).toHaveBeenCalledWith(
      "The deliveries of the webhook can't be read:",
      "GitHub answered 502: Server Error",
    );
    expect(redelivered(w)).toEqual([]);

    const second = listing(await world(), [
      [attempt("event", 10, 500)],
      [attempt("older", 20, 500)],
    ]);
    second.net.on("GET", `${DELIVERIES}&cursor=c1`, () =>
      json({ message: "Server Error" }, 500),
    );
    await failedEvents(second.context);
    expect(redelivered(second)).toHaveLength(1);
  });

  it("goes on after a redelivery that GitHub refuses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const one = attempt("one", 20, 500);
    const two = attempt("two", 10, 500);
    const w = listing(await world(), [[two, one]]);
    w.net.on("POST", `/app/hook/deliveries/${one.id}/attempts`, () =>
      json({ message: "Validation Failed" }, 422),
    );
    await failedEvents(w.context);
    expect(redelivered(w)).toEqual([one.id, two.id]);
    expect(warn).toHaveBeenCalledWith(
      `delivery ${one.id} again: GitHub answered 422: Validation Failed`,
    );
  });

  it("passes on an error that isn't an answer of GitHub", async () => {
    const w = listing(await world(), [[attempt("event", 10, 500)]]);
    const broken = vi
      .spyOn(w.context.github, "deliveries")
      .mockRejectedValueOnce(new TypeError("Network connection lost"));
    await expect(failedEvents(w.context)).rejects.toThrow(TypeError);
    broken.mockRestore();
    vi.spyOn(w.context.github, "redeliver").mockRejectedValueOnce(
      new TypeError("Network connection lost"),
    );
    await expect(failedEvents(w.context)).rejects.toThrow(TypeError);
  });
});

describe("the calls of a run of the schedule", () => {
  it("stay under the limit of the free plan in a dry run, with the alarm and ten redeliveries", async () => {
    const w = listing(await world({ tokenExpires: "2026-11-10" }), [
      [
        ...exhausted("thrice"),
        ...exhausted("again"),
        ...Array.from({ length: 12 }, (_, index) =>
          attempt(`event-${index}`, 10 + index, 500),
        ),
      ],
    ]);
    withTopics(w.net);
    // Things that "Later" put aside come back, each as a new message that
    // replaces the old one.
    for (let index = 0; index < 12; index += 1) {
      await w.context.store.put({
        ...base(`i0000000000000${String(index).padStart(2, "0")}`),
        kind: "alarm",
        state: "open",
        entries: [{ key: "bot:1", label: "A bot fails", url: "https://x" }],
        snoozedUntil: START - 1,
      } as Item);
    }
    const shown = await runSchedule(w.context);
    expect(shown).toHaveLength(14);
    expect(w.context.subrequests()).toBe(w.net.calls.length);
    expect(w.net.calls.length).toBeLessThanOrEqual(SUBREQUESTS);
    expect(redelivered(w)).toHaveLength(MAX_REDELIVERIES);
    // The second event that failed thrice waits for the next run.
    expect((await theAlarm(w))?.entries).toHaveLength(1);
  });

  it("leave the redeliveries what the steps before them left, and the alarm what is left then", async () => {
    const w = listing(await world(), [
      [
        ...exhausted("thrice"),
        ...Array.from({ length: 12 }, (_, index) =>
          attempt(`event-${index}`, 10 + index, 500),
        ),
      ],
    ]);
    spent(w, SUBREQUESTS - 6);
    await failedEvents(w.context);
    // One page, five redeliveries, and no room for the alarm.
    expect(redelivered(w)).toHaveLength(5);
    expect(await theAlarm(w)).toBeNull();

    const none = listing(await world(), [[attempt("event", 10, 500)]]);
    spent(none, SUBREQUESTS);
    expect(await failedEvents(none.context)).toEqual([]);
    expect(none.net.calls).toEqual([]);
  });

  it("put off what doesn't fit into the alarm until the next run", async () => {
    const w = listing(await world(), [
      [...exhausted("thrice"), ...exhausted("again")],
    ]);
    // Room for one page and one change of the alarm.
    spent(w, SUBREQUESTS - 1 - ALARM_CHANGE);
    const id = await itemId(keys.alarm(CONTROL));
    expect(await failedEvents(w.context)).toEqual([id]);
    expect((await theAlarm(w))?.entries).toHaveLength(1);

    const out = listing(await world(), [
      [attempt("thrice", 1, 200, { redelivery: true })],
    ]);
    await out.context.store.put({
      ...base(id),
      repo: CONTROL,
      kind: "alarm",
      state: "open",
      entries: [{ key: entryKey("thrice"), label: "old", url: ADVANCED }],
    } as Item);
    spent(out, SUBREQUESTS - ALARM_CHANGE);
    expect(await failedEvents(out.context)).toEqual([]);
    expect((await theAlarm(out))?.entries).toHaveLength(1);
  });
});

/** Everything in Workers KV: each key with its value and metadata. */
async function everything(): Promise<Record<string, unknown>> {
  const listed = await env.PAGER.list();
  return Object.fromEntries(
    await Promise.all(
      listed.keys.map(async (key) => [
        key.name,
        { value: await env.PAGER.get(key.name), metadata: key.metadata },
      ]),
    ),
  );
}

describe("each signal applied twice", () => {
  const at = { repo: REPO, installation: 9 };
  const SHA = "a1b2c3d4e5f60718293a";
  const STORAGE = "https://storage.example/artifact.zip?sig=x";
  const pull = {
    number: 30,
    state: "open",
    title: "chore: release 1.2.3",
    draft: false,
    mergeable_state: "clean",
    html_url: `https://github.com/${REPO}/pull/30`,
    head: {
      ref: "release-please--branches--main",
      sha: "abc",
      repo: { full_name: REPO },
    },
    base: { ref: "main", repo: { full_name: REPO, default_branch: "main" } },
  };

  /** A world in which each signal finds what it reads on GitHub. */
  async function served(): Promise<World> {
    const w = await world();
    withTopics(w.net);
    withControl(w.net).on(
      "POST",
      `/repos/${CONTROL}/dispatches`,
      () => new Response(null, { status: 204 }),
    );
    const bytes = await artifact([
      { path: "screenshots/large.png", status: "changed", share: 0.25 },
      { path: "screenshots/added.png", status: "new", share: null },
    ]);
    w.net
      .on("GET", `/repos/${REPO}/rules/branches/main`, () =>
        json([
          {
            type: "required_status_checks",
            parameters: { required_status_checks: [{ context: "lint" }] },
          },
        ]),
      )
      .on("GET", `/repos/${REPO}/pulls/30`, () => json(pull))
      .on("GET", `/repos/${REPO}/pulls/8`, () =>
        json({
          number: 8,
          state: "open",
          title: "Make it blue",
          html_url: `https://github.com/${REPO}/pull/8`,
          user: { login: "Dennis-Otto", type: "User" },
          head: { sha: SHA, repo: { full_name: REPO } },
        }),
      )
      .on("GET", `/repos/${REPO}/actions/runs/31/artifacts?per_page=100`, () =>
        json({
          artifacts: [{ id: 55, name: "visual", size_in_bytes: bytes.length }],
        }),
      )
      .on(
        "GET",
        `/repos/${REPO}/actions/artifacts/55/zip`,
        () =>
          new Response(null, { status: 302, headers: { location: STORAGE } }),
      )
      .on("GET", STORAGE, () => new Response(bytes as Uint8Array<ArrayBuffer>))
      .on("GET", /\/secret-scanning\/alerts\/\d+\/locations\?per_page=1$/, () =>
        json([{ type: "commit", details: { path: "config/.env" } }]),
      );
    return w;
  }

  const contribution: Signal = {
    ...at,
    type: "contribution",
    number: 12,
    pull: false,
    title: "It breaks",
    url: `https://github.com/${REPO}/issues/12`,
    author: "octocat",
    excerpt: "It crashes",
  };
  const discussion: Signal = {
    ...at,
    type: "discussion",
    number: 31,
    title: "How do I start?",
    url: `https://github.com/${REPO}/discussions/31`,
    author: "octocat",
    node: "D_1",
  };
  const discussionComment: Signal = {
    ...discussion,
    url: `https://github.com/${REPO}/discussions/31#discussioncomment-7`,
    author: "hubot",
    comment: "DC_7",
  };
  const failing = (
    key: string,
    title = key,
    type: "failing" | "still-failing" = "failing",
  ): Signal => ({
    ...at,
    type,
    key,
    label: { key: "entry.bot", values: { title } },
    url: "https://github.com/x",
  });
  const alert = (key: string): Signal => ({
    ...at,
    type: "alert-open",
    key,
    label: { key: "entry.alert", values: { severity: "High", what: key } },
    url: "https://github.com/alert",
  });
  const secret: Signal = {
    ...at,
    type: "secret-open",
    key: "secret:3",
    number: 3,
    what: "Mailchimp API Key",
    leaked: false,
    url: `https://github.com/${REPO}/security/secret-scanning/3`,
  };
  const report: Signal = {
    ...at,
    type: "advisory",
    ghsa: "GHSA-4f6x-8m2c-jq7p",
    url: `https://github.com/${REPO}/security/advisories/GHSA-4f6x-8m2c-jq7p`,
    severity: "high",
    reported: START,
  };
  const release: Signal = { ...at, type: "release-check", numbers: [30] };
  const pictures: Signal = {
    ...at,
    type: "pictures",
    number: 8,
    sha: SHA,
    run: 31,
  };

  /** The signals that come first, and the one that comes twice. */
  const cases: [string, Signal[], Signal][] = [
    ["contribution", [], contribution],
    ["discussion", [], discussion],
    ["discussion: a comment", [discussion], discussionComment],
    [
      "discussion: the discussion again after a comment",
      [discussion, discussionComment],
      discussion,
    ],
    [
      "discussion-done",
      [discussion],
      { ...at, type: "discussion-done", number: 31, reason: "closed" },
    ],
    [
      "comment",
      [],
      {
        ...at,
        type: "comment",
        number: 41,
        pull: false,
        title: "It breaks",
        url: `https://github.com/${REPO}/issues/41#issuecomment-5`,
        author: "octocat",
        comment: 5,
      },
    ],
    [
      "contribution-done",
      [contribution],
      { ...at, type: "contribution-done", number: 12, reason: "closed" },
    ],
    ["failing", [], failing("bot:1")],
    [
      "still-failing",
      [failing("bot:1")],
      failing("bot:1", "again", "still-failing"),
    ],
    [
      "recovered",
      [failing("bot:1"), failing("bot:2")],
      { ...at, type: "recovered", key: "bot:1" },
    ],
    [
      "check",
      [],
      {
        ...at,
        type: "check",
        name: "lint",
        failed: true,
        branch: "main",
        url: `https://github.com/${REPO}/actions/runs/31/job/2`,
        run: 31,
      },
    ],
    ["release-check", [], release],
    [
      "release-updated",
      [release],
      { ...at, type: "release-updated", number: 30, sha: "def" },
    ],
    [
      "release-merged",
      [release],
      { ...at, type: "release-merged", number: 30 },
    ],
    [
      "release-published",
      [release, { ...at, type: "release-merged", number: 30 }],
      { ...at, type: "release-published", tag: "v1.2.3" },
    ],
    ["pictures", [], pictures],
    [
      "pull-closed",
      [pictures],
      { ...at, type: "pull-closed", number: 8, merged: true },
    ],
    ["alert-open", [], alert("alert:1")],
    [
      "alert-closed",
      [alert("alert:1"), alert("alert:2")],
      { ...at, type: "alert-closed", key: "alert:1" },
    ],
    ["secret-open", [alert("alert:1")], secret],
    [
      "secret-open: leaked in public too",
      [secret],
      { ...secret, leaked: true },
    ],
    ["advisory", [], report],
    [
      "advisory-published",
      [report],
      { ...at, type: "advisory-published", ghsa: "GHSA-4f6x-8m2c-jq7p" },
    ],
  ];

  it("covers every kind of signal", () => {
    // The compiler fails here when a kind of signal is missing.
    const every: Record<Signal["type"], true> = {
      contribution: true,
      discussion: true,
      "discussion-done": true,
      comment: true,
      "contribution-done": true,
      failing: true,
      "still-failing": true,
      recovered: true,
      check: true,
      "release-check": true,
      "release-updated": true,
      "release-merged": true,
      "release-published": true,
      pictures: true,
      "pull-closed": true,
      "alert-open": true,
      "secret-open": true,
      "alert-closed": true,
      advisory: true,
      "advisory-published": true,
    };
    expect(new Set(cases.map(([, , signal]) => signal.type))).toEqual(
      new Set(Object.keys(every)),
    );
  });

  for (const [name, before, signal] of cases) {
    it(`leaves the same state: ${name}`, async () => {
      const w = await served();
      for (const each of [...before, signal]) {
        await apply(w.context, each);
      }
      const state = await everything();
      const calls = w.net.calls.length;
      const put = vi.spyOn(w.context.store, "put");
      const link = vi.spyOn(w.context.store, "link");
      await apply(w.context, signal);
      expect(await everything()).toEqual(state);
      expect(put).not.toHaveBeenCalled();
      expect(link).not.toHaveBeenCalled();
      // No message, no edit and no job: GitHub's calls of reading only.
      const after = w.net.calls.slice(calls);
      expect(
        after.filter(
          (call) =>
            call.url.startsWith("https://api.telegram.org/") ||
            call.url.endsWith("/dispatches"),
        ),
      ).toEqual([]);
    });
  }
});
