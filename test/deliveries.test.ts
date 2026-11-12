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
  FAILURE_PAGES,
  failed,
  failedEvents,
  LOOK_BACK,
  MAX_PAGES,
  MAX_REDELIVERIES,
  RESERVE,
  SEEN,
  type Seen,
  SHOW_AGAIN,
  SUBREQUESTS,
} from "../src/deliveries.ts";
import type { Delivery } from "../src/github.ts";
import { FAILED, type Failure, health, RAN } from "../src/health.ts";
import { apply, QUIET } from "../src/pager.ts";
import type { Signal } from "../src/rules.ts";
import { ANSWER_WITHIN, runSchedule } from "../src/schedule.ts";
import { type Alarm, type Item, itemId, keys } from "../src/store.ts";
import {
  base,
  DELIVERIES,
  FAILURES,
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
const ADVANCED = "https://github.com/settings/apps/repo-pager/advanced";
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

/** Whether GitHub lists a delivery among the failures: a code from 400 to 599. */
function failure(delivery: Delivery): boolean {
  return delivery.status_code >= 400 && delivery.status_code <= 599;
}

/** Serve the pages of a list of the webhook, each with the cursor of the next in its Link header. */
function serve(w: World, first: string, mark: string, pages: Delivery[][]) {
  pages.forEach((page, index) => {
    const url = index === 0 ? first : `${first}&cursor=${mark}${index}`;
    const headers: Record<string, string> =
      index + 1 < pages.length
        ? {
            link: `<${first}&cursor=${mark}${index - 1}>; rel="prev", <${first}&cursor=${mark}${index + 1}>; rel="next"`,
          }
        : {};
    w.net.on("GET", url, () => Response.json(page, { headers }));
  });
}

/** The failures among the pages, as GitHub lists them: on pages of 100 of their own. */
function failures(pages: Delivery[][]): Delivery[][] {
  const failed = pages.flat().filter(failure);
  return Array.from(
    { length: Math.max(1, Math.ceil(failed.length / 100)) },
    (_, page) => failed.slice(page * 100, page * 100 + 100),
  );
}

/**
 * The simulated app: its webhook lists these pages of deliveries, newest first,
 * and the failures among them on pages of their own, unless the test names
 * those; GitHub takes each redelivery, and the app is installed on the control
 * repository.
 */
function listing(
  w: World,
  pages: Delivery[][],
  failed: Delivery[][] = failures(pages),
): World {
  serve(w, DELIVERIES, "c", pages);
  serve(w, FAILURES, "f", failed);
  w.net
    .on("POST", ATTEMPTS, () => json({}, 202))
    .on("GET", /^https:\/\/api\.github\.com\/app$/, () =>
      json({
        slug: "repo-pager",
        owner: { login: "Dennis-Otto", type: "User" },
      }),
    );
  withControl(w.net);
  return w;
}

/** The pages of the lists of the webhook that a run read, in order. */
function lists(w: World): string[] {
  return w.net.calls
    .filter((call) => call.method === "GET" && call.url.startsWith(DELIVERIES))
    .map((call) => call.url);
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

  it("reads the failures on three pages at most, and back to three hours", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pages = [0, 1, 2, 3].map((page) => [
      attempt(`event-${page}`, 10 + page * 30, 500),
    ]);
    const w = listing(await world(), [[]], pages);
    await failedEvents(w.context);
    expect(lists(w)).toEqual([
      FAILURES,
      `${FAILURES}&cursor=f1`,
      `${FAILURES}&cursor=f2`,
      DELIVERIES,
    ]);
    expect(FAILURE_PAGES).toBe(3);
    expect(redelivered(w)).toHaveLength(3);
    // The next run reads the newest pages again, so the gap stays: the log says so.
    expect(warn).toHaveBeenCalledWith(
      `The failures of the webhook were read back to ${pages[2]?.[0]?.delivered_at}, not to three hours: an older failed event gets no more attempts and no entry in the alarm`,
    );

    const old = listing(await world(), [
      [attempt("new", 10, 500), attempt("old", LOOK_BACK / MINUTE + 1, 500)],
      [attempt("older", LOOK_BACK / MINUTE + 30, 500)],
    ]);
    await failedEvents(old.context);
    expect(lists(old)).toEqual([FAILURES, DELIVERIES]);
    expect(redelivered(old)).toHaveLength(1);

    const empty = listing(
      await world(),
      [[]],
      [[], [attempt("next", 10, 500)]],
    );
    expect(await failedEvents(empty.context)).toEqual([]);
    expect(redelivered(empty)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("finds a failed event behind more than 300 deliveries since the run before", async () => {
    // A rollout of the blueprint over the fleet: hundreds of workflow runs in a
    // quarter of an hour, each with deliveries of its own, which all passed.
    const before = attempt("before", 16, 200);
    const broken = attempt("broken", 14, 500, { event: "issues" });
    const late = attempt("late", 13, 0, { event: "issues" });
    const busy = Array.from({ length: 450 }, (_, index) => ({
      ...attempt(`run-${index}`, 12 - index / 50, 200, {
        event: "workflow_run",
        repository: 1 + (index % 10),
      }),
      id: late.id + 1000 + index,
    })).reverse();
    const all = [...busy, late, broken, before];
    const w = listing(
      await world(),
      Array.from({ length: 5 }, (_, page) =>
        all.slice(page * 100, page * 100 + 100),
      ),
    );
    await w.context.local.put<Seen>(SEEN, { newest: before.id, kept: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await failedEvents(w.context);
    // The failure on the list of its own, the answer that didn't come in time on
    // the pages back to the run before.
    expect(redelivered(w)).toEqual([broken.id, late.id]);
    expect(lists(w)).toEqual([
      FAILURES,
      DELIVERIES,
      ...[1, 2, 3, 4].map((page) => `${DELIVERIES}&cursor=c${page}`),
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect((await w.context.local.get<Seen>(SEEN))?.newest).toBe(busy[0]?.id);
  });

  it("keeps for the next runs what the list of the failures leaves out", async () => {
    const extra = { url: "https://api.github.com/...", installation_id: 7 };
    const timeout = { ...attempt("timeout", 50, 0), ...extra };
    const fixed = attempt("fixed", 40, 200, {
      redelivery: true,
      event: "workflow_run",
      repository: 1,
    });
    const fixedFirst = attempt("fixed", 60, 502, {
      event: "workflow_run",
      repository: 1,
    });
    const run = (minutes: number, repository: number) =>
      attempt(`run-${minutes}`, minutes, 200, {
        event: "workflow_run",
        repository,
      });
    const newest = run(20, 1);
    const elsewhere = run(25, 2);
    const comment = attempt("comment", 10, 200, {
      event: "issue_comment",
      repository: 1,
    });
    const w = listing(await world(), [
      [
        comment,
        attempt("refused", 15, 401),
        newest,
        elsewhere,
        run(30, 1),
        attempt("app", 35, 200, { event: "workflow_run" }),
        fixed,
        timeout,
        fixedFirst,
        attempt("expired", LOOK_BACK / MINUTE + 1, 0),
      ],
    ]);
    await failedEvents(w.context);
    // Only the fields that the pager reads; not the failures, which their own
    // list brings again, nor a delivery older than three hours, nor a pass that
    // overtakes nothing or that a newer one of its kind and repository stands for.
    const { url: _, installation_id: __, ...compact } = timeout;
    expect(await w.context.local.get<Seen>(SEEN)).toEqual({
      newest: comment.id,
      kept: [fixed, compact, newest, elsewhere],
    });

    // The next run reads only what came since, and still knows the older ones:
    // the stale run is overtaken, the answer that didn't come in time counts its
    // attempts, and the pass of the redelivery takes its entry out of the alarm.
    const stale = attempt("stale", 45, 500, {
      event: "workflow_run",
      repository: 1,
    });
    const again = attempt("timeout", 5, 0, { redelivery: true });
    const next = listing(await world(), [[again, comment]], [[stale]]);
    await next.context.local.put(SEEN, await w.context.local.get<Seen>(SEEN));
    const id = await itemId(keys.alarm(CONTROL));
    await next.context.store.put({
      ...base(id),
      repo: CONTROL,
      kind: "alarm",
      state: "open",
      entries: [
        { key: entryKey("fixed"), label: "old", url: ADVANCED },
        { key: entryKey("other"), label: "old", url: ADVANCED },
      ],
    } as Item);
    await failedEvents(next.context);
    expect(redelivered(next)).toEqual([again.id]);
    expect((await theAlarm(next))?.entries.map((entry) => entry.key)).toEqual([
      entryKey("other"),
    ]);
    expect((await next.context.local.get<Seen>(SEEN))?.kept).toEqual([
      fixed,
      compact,
      again,
      newest,
      elsewhere,
    ]);
  });

  it("says in the log when it can't read back to the run before, and waits when there is no room", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pages = [0, 1, 2].map((page) => [
      attempt(`event-${page}`, 1 + page, 200),
    ]);
    const w = listing(await world(), pages);
    await w.context.local.put<Seen>(SEEN, { newest: 1, kept: [] });
    // Room for the failures, one page of every outcome and what it leaves.
    spent(w, SUBREQUESTS - 2 - RESERVE);
    await failedEvents(w.context);
    expect(lists(w)).toEqual([FAILURES, DELIVERIES]);
    expect(warn).toHaveBeenCalledWith(
      `The deliveries of the webhook were read back to ${pages[0]?.[0]?.delivered_at}, not to delivery 1 of the run before: an answer that didn't come in time before then is missed, and so is an attempt that passed`,
    );
    expect((await w.context.local.get<Seen>(SEEN))?.newest).toBe(
      pages[0]?.[0]?.id,
    );

    // No room for any page of every outcome: the next run reads them all.
    const full = listing(await world(), pages);
    await full.context.local.put<Seen>(SEEN, { newest: 1, kept: [] });
    spent(full, SUBREQUESTS - 1 - RESERVE);
    await failedEvents(full.context);
    expect(lists(full)).toEqual([FAILURES]);
    expect((await full.context.local.get<Seen>(SEEN))?.newest).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);

    // Nor does it act on the failures alone: a newer pass that only the list of
    // every outcome shows would overtake the failed run.
    const stale = attempt("stale", 40, 500, {
      event: "workflow_run",
      repository: 1,
    });
    const newer = attempt("newer", 30, 200, {
      event: "workflow_run",
      repository: 1,
    });
    const blind = listing(await world(), [[newer, stale]]);
    await blind.context.local.put<Seen>(SEEN, { newest: 1, kept: [] });
    spent(blind, SUBREQUESTS - 1 - RESERVE);
    expect(await failedEvents(blind.context)).toEqual([]);
    expect(lists(blind)).toEqual([FAILURES]);
    expect(redelivered(blind)).toEqual([]);

    // The first run reads back three hours, as far as the pages go.
    const first = listing(await world(), pages);
    spent(first, SUBREQUESTS - 2 - RESERVE);
    await failedEvents(first.context);
    expect(warn).toHaveBeenLastCalledWith(
      `The deliveries of the webhook were read back to ${pages[0]?.[0]?.delivered_at}, not to three hours: an answer that didn't come in time before then is missed, and so is an attempt that passed`,
    );
    expect(MAX_PAGES).toBe(20);
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

  it("lets neither an alert of secret scanning nor a report be overtaken", async () => {
    // Secret scanning sends one event per alert in a burst, and a leak missed is
    // worse than a late copy, which its time keeps out once the alert was
    // resolved; a report that comes again is shown once, and a report missed is
    // a promise missed.
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
    expect(redelivered(w)).toEqual([found.id, reported.id]);
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
    for (const list of [DELIVERIES, FAILURES]) {
      w.net.on("GET", list, () => json({ message: "Server Error" }, 502));
    }
    // The steps before it ran: the reminder of the token came.
    const reminder = await itemId(keys.reminder("claude-token:2026-11-10"));
    expect(await runSchedule(w.context)).toEqual([reminder]);
    expect(error).toHaveBeenCalledWith(
      "The deliveries of the webhook can't be read:",
      "GitHub answered 502: Server Error",
    );
    expect(error).toHaveBeenCalledTimes(2);
    expect(redelivered(w)).toEqual([]);
    // Nothing was read: the next run reads back to where the run before stopped.
    expect(await w.context.local.get<Seen>(SEEN)).toEqual({
      newest: null,
      kept: [],
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pages = [[attempt("event", 10, 500)], [attempt("older", 20, 500)]];
    const second = listing(await world(), pages, pages);
    second.net.on("GET", `${FAILURES}&cursor=f1`, () =>
      json({ message: "Server Error" }, 500),
    );
    await failedEvents(second.context);
    expect(redelivered(second)).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
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
    const thrice = exhausted("thrice");
    const again = exhausted("again");
    const w = listing(await world({ tokenExpires: "2026-11-10" }), [
      [
        ...thrice,
        ...again,
        ...Array.from({ length: 12 }, (_, index) =>
          attempt(`event-${index}`, 10 + index, 500),
        ),
      ],
    ]);
    // The answers that didn't come in time, as the run before kept them.
    await w.context.local.put<Seen>(SEEN, {
      newest: null,
      kept: [thrice[0], again[0]] as Delivery[],
    });
    withTopics(w.net);
    // Things that "Later" put aside come back, each as a new message that
    // replaces the old one: as many as leave room for the failures and one page
    // of every outcome.
    for (let index = 0; index < 11; index += 1) {
      await w.context.store.put({
        ...base(`i0000000000000${String(index).padStart(2, "0")}`),
        kind: "alarm",
        state: "open",
        entries: [{ key: "bot:1", label: "A bot fails", url: "https://x" }],
        snoozedUntil: START - 1,
      } as Item);
    }
    const shown = await runSchedule(w.context);
    expect(shown).toHaveLength(13);
    expect(lists(w)).toEqual([FAILURES, DELIVERIES]);
    expect(w.context.subrequests()).toBe(w.net.calls.length);
    expect(w.net.calls.length).toBeLessThanOrEqual(SUBREQUESTS);
    expect(redelivered(w)).toHaveLength(MAX_REDELIVERIES);
    // The second event that failed thrice waits for the next run.
    expect((await theAlarm(w))?.entries).toHaveLength(1);
  });

  it("leave the redeliveries and the alarm to the next run when no page of every outcome fits", async () => {
    const w = listing(await world(), [
      [
        ...exhausted("thrice"),
        ...Array.from({ length: 12 }, (_, index) =>
          attempt(`event-${index}`, 10 + index, 500),
        ),
      ],
    ]);
    spent(w, SUBREQUESTS - 6);
    expect(await failedEvents(w.context)).toEqual([]);
    // The failures, and no room for a page of every outcome: what passed since
    // the run before is unknown, so nothing comes again and the alarm waits.
    expect(lists(w)).toEqual([FAILURES]);
    expect(redelivered(w)).toEqual([]);
    expect(await theAlarm(w)).toBeNull();

    const none = listing(await world(), [[attempt("event", 10, 500)]]);
    spent(none, SUBREQUESTS);
    expect(await failedEvents(none.context)).toEqual([]);
    expect(none.net.calls).toEqual([]);
  });

  it("put off what doesn't fit into the alarm until the next run", async () => {
    const thrice = exhausted("thrice");
    const again = exhausted("again");
    const fresh = Array.from({ length: MAX_REDELIVERIES }, (_, index) =>
      attempt(`fresh-${index}`, 50 + index, 500),
    );
    const w = listing(await world(), [[...thrice, ...again, ...fresh]]);
    // Room for the failures and one page of every outcome, which leaves the
    // redeliveries and one change of the alarm.
    expect(RESERVE).toBe(MAX_REDELIVERIES + ALARM_CHANGE);
    spent(w, SUBREQUESTS - 2 - RESERVE);
    const id = await itemId(keys.alarm(CONTROL));
    expect(await failedEvents(w.context)).toEqual([id]);
    expect(redelivered(w)).toHaveLength(MAX_REDELIVERIES);
    expect((await theAlarm(w))?.entries).toHaveLength(1);

    // An attempt that passed, which the run before kept: there is room for the
    // failures, and none for the pages of every outcome, which the run leaves
    // to the next together with the change of the alarm.
    const out = listing(await world(), [[]]);
    await out.context.local.put<Seen>(SEEN, {
      newest: null,
      kept: [attempt("thrice", 1, 200, { redelivery: true })],
    });
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

    // Two attempts that passed, and ten redeliveries before them: room for one
    // change of the alarm, and the second entry leaves in the next run.
    const both = listing(await world(), [
      [
        attempt("thrice", 1, 200, { redelivery: true }),
        attempt("again", 2, 200, { redelivery: true }),
        ...fresh,
      ],
    ]);
    await both.context.store.put({
      ...base(id),
      repo: CONTROL,
      kind: "alarm",
      state: "open",
      entries: [
        { key: entryKey("thrice"), label: "old", url: ADVANCED },
        { key: entryKey("again"), label: "old", url: ADVANCED },
      ],
    } as Item);
    spent(both, SUBREQUESTS - 2 - RESERVE);
    expect(await failedEvents(both.context)).toEqual([id]);
    expect(redelivered(both)).toHaveLength(MAX_REDELIVERIES);
    expect((await theAlarm(both))?.entries).toHaveLength(1);
  });

  it("leave the things that no longer fit to the next run, each whole", async () => {
    const w = await world({ tokenExpires: "2026-11-10" });
    await later(w, "i00000000000001", "First");
    await later(w, "i00000000000002", "Second");
    await w.context.store.put({
      ...base("i00000000000003"),
      kind: "alarm",
      state: "fixing",
      entries: [{ key: "bot:3", label: "Third bot fails", url: "https://x" }],
      jobStarted: START - ANSWER_WITHIN - 1,
    } as Item);
    // Room for one thing that comes again as a new message, and not for two.
    spent(w, SUBREQUESTS - SHOW_AGAIN);
    expect(await runSchedule(w.context)).toEqual(["i00000000000001"]);
    expect(w.context.subrequests()).toBeLessThanOrEqual(SUBREQUESTS);
    // The others wait, unchanged, for the next run.
    expect((await w.context.store.get("i00000000000002"))?.snoozedUntil).toBe(
      START - 1,
    );
    expect((await w.context.store.get("i00000000000003"))?.state).toBe(
      "fixing",
    );
    expect(
      await w.context.store.get(
        await itemId(keys.reminder("claude-token:2026-11-10")),
      ),
    ).toBeNull();
  });
});

/** An alarm that "Later" put aside and whose time is up: its label names it. */
async function later(w: World, id: string, label: string): Promise<void> {
  await w.context.store.put({
    ...base(id),
    kind: "alarm",
    state: "open",
    entries: [{ key: "bot:1", label: `${label} bot fails`, url: "https://x" }],
    snoozedUntil: START - 1,
  } as Item);
}

describe("a thing that fails in a run of the schedule", () => {
  it("costs only itself: the other things, the later steps and the redeliveries go on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = attempt("broken", 20, 500);
    const w = listing(await world({ tokenExpires: "2026-11-10" }), [[broken]]);
    await later(w, "i00000000000001", "Refused");
    await later(w, "i00000000000002", "Second");
    w.net.on("POST", /\/sendMessage$/, (call) =>
      String(call.body.text).includes("Refused bot fails")
        ? json(
            {
              ok: false,
              error_code: 400,
              description: "Bad Request: message is too long",
            },
            400,
          )
        : undefined,
    );
    const reminder = await itemId(keys.reminder("claude-token:2026-11-10"));
    expect(await runSchedule(w.context)).toEqual(["i00000000000002", reminder]);
    // The event that failed comes again, after the thing that failed.
    expect(redelivered(w)).toEqual([broken.id]);
    const failure: Failure = {
      at: new Date(START).toISOString(),
      what: "the things that come back, thing i00000000000001",
      error: "Telegram sendMessage: Bad Request: message is too long",
    };
    expect(error).toHaveBeenCalledWith(
      `The schedule failed at ${failure.what}:`,
      failure.error,
    );
    // The thing that failed is due in the next run as well.
    expect((await w.context.store.get("i00000000000001"))?.snoozedUntil).toBe(
      START - 1,
    );
    // The run didn't come to its end, and the health answer says why.
    expect(await w.context.local.get(RAN)).toBeUndefined();
    expect(await w.context.local.get(FAILED)).toEqual(failure);
    expect((await health(w.context)).failure).toEqual(failure);
  });

  it("goes on after a check that a network that breaks stops", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = attempt("broken", 20, 500);
    const w = listing(
      await world({ tokenExpires: "2026-11-10", userToken: "ghp_test" }),
      [[broken]],
    );
    vi.spyOn(w.context.github, "userTokenExpiration").mockRejectedValueOnce(
      new TypeError("Network connection lost"),
    );
    const reminder = await itemId(keys.reminder("claude-token:2026-11-10"));
    expect(await runSchedule(w.context)).toEqual([reminder]);
    expect(redelivered(w)).toEqual([broken.id]);
    expect(error).toHaveBeenCalledWith(
      "The schedule failed at the reminders of the tokens, the check of GITHUB_USER_TOKEN:",
      "TypeError",
    );
    expect(await w.context.local.get(RAN)).toBeUndefined();
    // The next run that comes to its end notes its time; the health answer
    // keeps the last failure, with its own time.
    await runSchedule(w.context);
    expect(await w.context.local.get(RAN)).toBe(START);
    expect((await health(w.context)).failure?.at).toBe(
      new Date(START).toISOString(),
    );
  });

  it("goes on after a step that fails as a whole", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world({ tokenExpires: "2026-11-10" });
    vi.spyOn(w.context.store, "waiting").mockRejectedValueOnce(
      new TypeError("KV GET failed"),
    );
    const reminder = await itemId(keys.reminder("claude-token:2026-11-10"));
    expect(await runSchedule(w.context)).toEqual([reminder]);
    expect(error).toHaveBeenCalledWith(
      "The schedule failed at the texts without an answer:",
      "TypeError",
    );
    expect(await w.context.local.get(RAN)).toBeUndefined();
  });

  it("keeps its new message in its record when what follows the send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world();
    await later(w, "i00000000000001", "First");
    w.net.on("POST", /\/deleteMessage$/, () => {
      throw new TypeError("Network connection lost");
    });
    expect(await runSchedule(w.context)).toEqual(["i00000000000001"]);
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    const kept = await w.context.store.get("i00000000000001");
    expect(kept?.messageId).toBe(100);
    expect(kept?.snoozedUntil).toBeNull();
    // The next run doesn't send it again, with live buttons on two messages.
    expect(await runSchedule(w.context)).toEqual([]);
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
  });

  it("goes on when the storage can't note the failure either", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = attempt("broken", 20, 500);
    const w = listing(await world(), [[broken]]);
    vi.spyOn(w.context.store, "waiting").mockRejectedValueOnce(
      new TypeError("KV GET failed"),
    );
    vi.spyOn(w.context.local, "put").mockRejectedValueOnce(
      new TypeError("Durable Object storage failed"),
    );
    expect(await runSchedule(w.context)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      "The schedule couldn't note the failure at the texts without an answer:",
      "TypeError",
    );
    // The events that failed still come again.
    expect(redelivered(w)).toEqual([broken.id]);
    expect(await w.context.local.get(RAN)).toBeUndefined();
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
      .on("GET", `/repos/${REPO}/actions/runs/60`, () =>
        json({
          id: 60,
          name: "Docs",
          path: ".github/workflows/docs.yml",
          event: "push",
          status: "completed",
          conclusion: "failure",
          html_url: `https://github.com/${REPO}/actions/runs/60`,
          head_branch: "main",
          run_attempt: 1,
        }),
      )
      .on("GET", `/repos/${REPO}/actions/runs/62`, () =>
        json({
          id: 62,
          name: "Docs",
          path: ".github/workflows/docs.yml",
          event: "push",
          status: "completed",
          conclusion: "cancelled",
          html_url: `https://github.com/${REPO}/actions/runs/62`,
          head_branch: "main",
          run_attempt: 1,
        }),
      )
      .on(
        "GET",
        /\/actions\/runs\/6\d\/attempts\/\d\/jobs\?per_page=100$/,
        () =>
          json({
            jobs: [
              {
                name: "build",
                html_url: `https://github.com/${REPO}/actions/runs/60/job/1`,
                conclusion: "failure",
              },
            ],
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
  const issueComment: Extract<Signal, { type: "comment" }> = {
    ...at,
    type: "comment",
    number: 41,
    pull: false,
    title: "It breaks",
    url: `https://github.com/${REPO}/issues/41#issuecomment-5`,
    author: "octocat",
    comment: 5,
  };
  const commits: Extract<Signal, { type: "activity" }> = {
    ...at,
    type: "activity",
    number: 12,
    pull: false,
    title: "It breaks",
    url: `https://github.com/${REPO}/issues/12`,
    author: "octocat",
    by: "octocat",
    what: "commits",
    changed: "2026-11-12T08:00:00Z",
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
  const upload = (type: "failing" | "still-failing"): Signal => ({
    ...at,
    type,
    key: "issue:123",
    label: { key: "entry.preview" },
    url: `https://github.com/${REPO}/issues/123`,
    upload: true,
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
    time: 0,
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
  const workflow = (run: number, attempt: number, failed: boolean): Signal => ({
    ...at,
    type: "workflow",
    path: ".github/workflows/docs.yml",
    name: "Docs",
    branch: "main",
    failed,
    run,
    attempt,
    url: `https://github.com/${REPO}/actions/runs/${run}/attempts/${attempt}`,
  });
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
    ["comment", [], issueComment],
    [
      "comment: a review comment after a newer comment of another kind",
      [contribution, { ...issueComment, number: 12, comment: 99 }],
      { ...issueComment, number: 12, comment: 5, kind: "reviewComment" },
    ],
    [
      "comment: an older comment of another kind after a review",
      [
        contribution,
        { ...issueComment, number: 12, comment: 99 },
        { ...issueComment, number: 12, comment: 7, kind: "review" },
      ],
      { ...issueComment, number: 12, comment: 98 },
    ],
    ["activity: a thing that it makes", [], commits],
    ["activity: an open thing", [contribution], commits],
    [
      "activity: a thing that it opens again",
      [
        contribution,
        { ...at, type: "contribution-done", number: 12, reason: "replied" },
      ],
      commits,
    ],
    [
      "activity: another after a comment",
      [contribution, commits, { ...issueComment, number: 12, comment: 99 }],
      { ...commits, what: "ready" },
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
    ["failing: an upload", [], upload("failing")],
    [
      "still-failing: an upload kept before its mark",
      [failing("issue:123", "Upload the new social preview")],
      upload("still-failing"),
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
        url: `https://github.com/${REPO}/runs/2`,
      },
    ],
    ["workflow: a failure that waits", [], workflow(60, 1, true)],
    ["workflow: a failure that shows", [], workflow(60, 2, true)],
    [
      "workflow: a failure again",
      [workflow(60, 2, true)],
      workflow(61, 1, true),
    ],
    ["workflow: a pass", [workflow(60, 2, true)], workflow(61, 1, false)],
    [
      "health",
      [],
      {
        ...at,
        type: "health",
        run: 60,
        branch: "main",
        fallback: {
          type: "failing",
          key: "issue:5",
          label: { key: "entry.bot", values: { title: "Docs fails" } },
          url: `https://github.com/${REPO}/issues/5`,
          run: 60,
        },
      },
    ],
    [
      "health: a run that GitHub stopped at its time limit",
      [],
      {
        ...at,
        type: "health",
        run: 62,
        branch: "main",
        fallback: {
          type: "failing",
          key: "issue:7",
          label: { key: "entry.bot", values: { title: "Docs hangs" } },
          url: `https://github.com/${REPO}/issues/7`,
          run: 62,
        },
      },
    ],
    [
      "health: a run that can't be read",
      [],
      {
        ...at,
        type: "health",
        run: 404,
        branch: "main",
        fallback: {
          type: "failing",
          key: "issue:6",
          label: { key: "entry.bot", values: { title: "Lint fails" } },
          url: `https://github.com/${REPO}/issues/6`,
          run: 404,
        },
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
      "secret-closed",
      [secret],
      { ...at, type: "secret-closed", key: "secret:3", number: 3, time: 1 },
    ],
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
      activity: true,
      "contribution-done": true,
      failing: true,
      "still-failing": true,
      recovered: true,
      check: true,
      workflow: true,
      health: true,
      "release-check": true,
      "release-updated": true,
      "release-merged": true,
      "release-published": true,
      pictures: true,
      "pull-closed": true,
      "alert-open": true,
      "secret-open": true,
      "alert-closed": true,
      "secret-closed": true,
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

  const joining: [string, Signal, Signal, string][] = [
    ["failing", failing("bot:1"), failing("bot:2"), "alarm"],
    ["alert-open", alert("alert:1"), alert("alert:2"), "alert"],
    ["secret-open", alert("alert:1"), secret, "alert"],
  ];
  for (const [name, first, signal, kind] of joining) {
    it(`notifies once of a new entry of an open bundle: ${name}`, async () => {
      const w = await served();
      await apply(w.context, first);
      w.clock.now = START + QUIET;
      expect(await apply(w.context, signal)).toBe(`new entry in the ${kind}`);
      const state = await everything();
      const calls = w.net.calls.length;
      // GitHub's second delivery of the same event sends no second notice.
      expect(await apply(w.context, signal)).toBe(`${kind} unchanged`);
      expect(await everything()).toEqual(state);
      expect(
        w.net.calls
          .slice(calls)
          .filter((call) => call.url.startsWith("https://api.telegram.org/")),
      ).toEqual([]);
    });
  }
});
