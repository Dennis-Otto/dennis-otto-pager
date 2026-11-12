// A workflow that fails on the default branch: its thing waits for a rerun, shows
// once, counts each run that fails again in place, turns green when a run passes
// the jobs that failed, and takes 🔁 Rerun and ✖ Ignore; the schedule shows a
// failure whose rerun didn't help, and an issue of the bot-health bot is read as
// the run that it names.
import { describe, expect, it, vi } from "vitest";

import { press } from "../src/actions.ts";
import { allowed } from "../src/buttons.ts";
import { SUBREQUESTS } from "../src/deliveries.ts";
import { apply, MAX_JOBS, WAIT } from "../src/pager.ts";
import type { Signal } from "../src/rules.ts";
import { runSchedule } from "../src/schedule.ts";
import {
  type Alarm,
  type Item,
  itemId,
  keys,
  type Workflow,
} from "../src/store.ts";
import { TOPIC_COLORS } from "../src/telegram.ts";
import { texts } from "../src/texts.ts";
import { about } from "../src/topics.ts";
import { SETTLE } from "../src/workflows.ts";
import { json, REPO, START, type World, withTopics, world } from "./helpers.ts";

const at = { repo: REPO, installation: 9 };
const PATH = ".github/workflows/docs.yml";
const RUNS = `https://github.com/${REPO}/actions/runs`;
const API = `/repos/${REPO}/actions/runs`;
const MINUTE = 60_000;

/** The end of an attempt of a run of the workflow Docs on main. */
function ran(run: number, attempt: number, failed = true, path = PATH): Signal {
  return {
    ...at,
    type: "workflow",
    path,
    name: "Docs",
    branch: "main",
    failed,
    run,
    attempt,
    url: `${RUNS}/${run}/attempts/${attempt}`,
  };
}

/** The jobs of an attempt, as GitHub lists them, by their names and conclusions. */
function jobs(
  w: World,
  run: number,
  attempt: number,
  list: [string, string | null][],
): void {
  w.net.on("GET", `${API}/${run}/attempts/${attempt}/jobs?per_page=100`, () =>
    json({
      jobs: [
        ...list.map(([name, conclusion], index) => ({
          name,
          conclusion,
          html_url: `${RUNS}/${run}/job/${index + 1}`,
        })),
        // GitHub names every job; one without its fields is dropped.
        { conclusion: "failure" },
      ],
    }),
  );
}

/** The run as GitHub shows its newest attempt. */
function runIs(w: World, run: number, fields: object): void {
  w.net.on("GET", `${API}/${run}`, () =>
    json({
      id: run,
      name: "Docs",
      path: PATH,
      event: "push",
      head_branch: "main",
      html_url: `${RUNS}/${run}`,
      ...fields,
    }),
  );
}

async function thing(w: World, path = PATH): Promise<Workflow> {
  return (await w.context.store.get(
    await itemId(keys.workflow(REPO, path)),
  )) as Workflow;
}

function telegram(w: World) {
  return w.net.calls.filter((call) =>
    call.url.startsWith("https://api.telegram.org/"),
  );
}

function pressing(w: World, item: Item, action: "rerun" | "ignore") {
  return press(w.context, item, { action, id: item.id, version: null });
}

describe("a workflow that fails on the default branch", () => {
  it("waits unseen for a rerun of its first attempt, and shows once the rerun failed too", async () => {
    const w = await world();
    jobs(w, 60, 1, [
      ["build", "failure"],
      ["deploy", "skipped"],
      ["links", "timed_out"],
      ["running", null],
    ]);
    expect(await apply(w.context, ran(60, 1))).toBe("workflow waiting");
    expect(telegram(w)).toEqual([]);
    expect(await thing(w)).toMatchObject({
      kind: "workflow",
      state: "waiting",
      messageId: null,
      snoozedUntil: START + WAIT,
      run: 60,
      attempt: 1,
      count: 1,
      since: START,
      last: START,
      jobs: [
        { name: "build", url: `${RUNS}/60/job/1` },
        { name: "links", url: `${RUNS}/60/job/3` },
      ],
    });
    // The token reads the jobs and nothing else.
    expect(
      w.net.github("/access_tokens").map((call) => call.body.permissions),
    ).toEqual([{ actions: "read" }]);

    w.clock.now = START + 3 * MINUTE;
    jobs(w, 60, 2, [["build", "failure"]]);
    expect(await apply(w.context, ran(60, 2))).toBe("workflow failing");
    const sent = w.net.telegram("sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.text).toBe(
      [
        `🔴 <b>Docs fails on main in <a href="https://github.com/${REPO}">${REPO}</a></b>`,
        `Failed: <a href="${RUNS}/60/job/1">build</a>`,
        "Failed on 2026-11-04 at 08:03 UTC.",
      ].join("\n"),
    );
    expect(sent[0]?.body.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: "🔁 Rerun", callback_data: `rerun:${(await thing(w)).id}` },
          { text: "✖ Ignore", callback_data: `ignore:${(await thing(w)).id}` },
        ],
      ],
    });
    expect(await thing(w)).toMatchObject({
      state: "failing",
      snoozedUntil: null,
      attempt: 2,
      count: 1,
      url: `${RUNS}/60/attempts/2`,
      messageId: 100,
    });
  });

  it("counts each run that fails again in place, with its time, and notifies once", async () => {
    const w = await world();
    await apply(w.context, ran(60, 2));
    w.clock.now = START + 60 * MINUTE;
    // GitHub doesn't list the jobs of the next run: its message links the run.
    expect(await apply(w.context, ran(61, 1))).toBe("workflow updated");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    const edits = w.net.telegram("editMessageText");
    expect(edits).toHaveLength(1);
    expect(edits[0]?.body.text).toContain(
      `<a href="${RUNS}/61/attempts/1">The run that failed</a>\nFailed 2 times since 2026-11-04 at 08:00 UTC, the last time on 2026-11-04 at 09:00 UTC.`,
    );
    expect(await thing(w)).toMatchObject({ count: 2, run: 61, jobs: [] });
    // The same run twice, and an older one, change nothing.
    const put = vi.spyOn(w.context.store, "put");
    expect(await apply(w.context, ran(61, 1))).toBe("workflow knows the run");
    expect(await apply(w.context, ran(60, 3))).toBe("workflow knows the run");
    expect(put).not.toHaveBeenCalled();
    // A rerun of the newest run that failed again counts no run more.
    expect(await apply(w.context, ran(61, 2))).toBe("workflow updated");
    expect(await thing(w)).toMatchObject({ count: 2, attempt: 2 });
  });

  it("keeps waiting for a newer run that fails in its first attempt, and shows a failed rerun at once", async () => {
    const w = await world();
    await apply(w.context, ran(60, 1));
    w.clock.now = START + 5 * MINUTE;
    expect(await apply(w.context, ran(61, 1))).toBe("workflow waiting");
    expect(await thing(w)).toMatchObject({
      state: "waiting",
      count: 2,
      run: 61,
      snoozedUntil: START + WAIT,
    });
    expect(await apply(w.context, ran(61, 2))).toBe("workflow failing");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
  });

  it("names at most a few of the jobs that failed", async () => {
    const w = await world();
    jobs(
      w,
      60,
      2,
      Array.from({ length: MAX_JOBS + 2 }, (_, index) => [
        `test ${index}`,
        "failure",
      ]),
    );
    await apply(w.context, ran(60, 2));
    expect((await thing(w)).jobs).toHaveLength(MAX_JOBS);
  });

  it("stops at an error that isn't an answer of GitHub", async () => {
    const w = await world();
    vi.spyOn(w.context.github, "jobs").mockRejectedValue(new TypeError("lost"));
    await expect(apply(w.context, ran(60, 1))).rejects.toThrow("lost");
  });
});

describe("a workflow that passes", () => {
  it("ends a thing that waits unseen when the rerun of its run passed", async () => {
    const w = await world();
    await apply(w.context, ran(60, 1));
    expect(await apply(w.context, ran(60, 2, false))).toBe(
      "workflow passed before it showed",
    );
    expect(telegram(w)).toEqual([]);
    expect(await thing(w)).toMatchObject({
      state: "recovered",
      attempt: 2,
      snoozedUntil: null,
    });
    expect(await apply(w.context, ran(60, 2, false))).toBe(
      "no failing workflow",
    );
    // A new failure starts to count anew, and waits again.
    w.clock.now = START + 60 * MINUTE;
    expect(await apply(w.context, ran(62, 1))).toBe("workflow waiting");
    expect(await thing(w)).toMatchObject({
      state: "waiting",
      count: 1,
      since: START + 60 * MINUTE,
      snoozedUntil: START + 60 * MINUTE + WAIT,
    });
  });

  it("turns green in place once a newer run passes the jobs that failed", async () => {
    const w = await world();
    jobs(w, 60, 2, [["build", "failure"]]);
    await apply(w.context, ran(60, 2));
    // A run of the same workflow that skipped the job, as a bot does that runs
    // one job per event, tells nothing.
    jobs(w, 61, 1, [
      ["build", "skipped"],
      ["other", "success"],
    ]);
    const put = vi.spyOn(w.context.store, "put");
    expect(await apply(w.context, ran(61, 1, false))).toBe(
      "workflow still failing",
    );
    expect(put).not.toHaveBeenCalled();
    jobs(w, 62, 1, [["build", "success"]]);
    expect(await apply(w.context, ran(62, 1, false))).toBe(
      "workflow recovered",
    );
    const edit = w.net.telegram("editMessageText").at(-1)?.body;
    expect(edit?.text).toMatch(/\n✅ Green again\.$/);
    expect(edit?.reply_markup).toEqual({ inline_keyboard: [] });
    expect(await thing(w)).toMatchObject({ state: "recovered", run: 62 });
  });

  it("takes a job that a newer run doesn't list as gone, and a run whose jobs it can't read as no answer", async () => {
    const w = await world();
    jobs(w, 60, 2, [["build", "failure"]]);
    await apply(w.context, ran(60, 2));
    expect(await apply(w.context, ran(61, 1, false))).toBe(
      "workflow still failing",
    );
    jobs(w, 62, 1, [["build (renamed)", "success"]]);
    expect(await apply(w.context, ran(62, 1, false))).toBe(
      "workflow recovered",
    );
  });

  it("ends at the first pass when it knows no job that failed", async () => {
    const w = await world();
    await apply(w.context, ran(60, 2));
    expect(await apply(w.context, ran(59, 1, false))).toBe(
      "workflow knows the run",
    );
    expect(await apply(w.context, ran(61, 1, false))).toBe(
      "workflow recovered",
    );
    expect(w.net.github("/runs/61/attempts/1/jobs?per_page=100")).toEqual([]);
  });

  it("means nothing for a workflow that never failed", async () => {
    const w = await world();
    const put = vi.spyOn(w.context.store, "put");
    expect(await apply(w.context, ran(60, 1, false))).toBe(
      "no failing workflow",
    );
    expect(put).not.toHaveBeenCalled();
    expect(w.net.calls).toEqual([]);
  });
});

describe("the buttons of a workflow", () => {
  it("offer 🔁 Rerun and ✖ Ignore while it fails, and ✖ Ignore while it runs again", async () => {
    const w = await world();
    await apply(w.context, ran(60, 2));
    const item = await thing(w);
    expect(allowed(item)).toEqual(["rerun", "ignore"]);
    expect(allowed({ ...item, state: "rerunning" })).toEqual(["ignore"]);
    for (const state of ["waiting", "recovered", "ignored"] as const) {
      expect(allowed({ ...item, state })).toEqual([]);
    }
  });

  it("run the failed jobs of its newest run again, and show that they run until the run ends", async () => {
    const w = await world();
    jobs(w, 60, 2, [["build", "failure"]]);
    await apply(w.context, ran(60, 2));
    runIs(w, 60, {
      status: "completed",
      conclusion: "failure",
      run_attempt: 2,
    });
    w.net.on(
      "POST",
      `${API}/60/rerun-failed-jobs`,
      () => new Response(null, { status: 201 }),
    );
    expect(await pressing(w, await thing(w), "rerun")).toEqual({
      text: "The failed jobs run again: a pass turns it ✅, a failure says so.",
      alert: false,
    });
    expect(w.net.github("/60/rerun-failed-jobs")).toHaveLength(1);
    expect(await thing(w)).toMatchObject({ state: "rerunning" });
    const edit = w.net.telegram("editMessageText").at(-1)?.body;
    expect(edit?.text).toMatch(/\n🔁 The failed jobs run again…$/);
    expect(edit?.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: "✖ Ignore", callback_data: `ignore:${(await thing(w)).id}` }],
      ],
    });
    // The rerun failed again: the message says so, and offers the button again.
    expect(await apply(w.context, ran(60, 3))).toBe("workflow updated");
    expect(await thing(w)).toMatchObject({ state: "failing", count: 1 });
    // Or a rerun passes, which turns it green.
    expect(await apply(w.context, ran(60, 4, false))).toBe(
      "workflow recovered",
    );
  });

  it("start nothing while the run still runs, or once it passed", async () => {
    const w = await world();
    await apply(w.context, ran(60, 2));
    runIs(w, 60, { status: "in_progress", conclusion: null, run_attempt: 3 });
    expect(await pressing(w, await thing(w), "rerun")).toEqual({
      text: "It still runs, or a newer attempt of it runs: nothing was started.",
      alert: true,
    });
    runIs(w, 60, {
      status: "completed",
      conclusion: "success",
      run_attempt: 3,
    });
    expect(await pressing(w, await thing(w), "rerun")).toEqual({
      text: "It passed already on a retry: nothing was started.",
      alert: true,
    });
    runIs(w, 60, { status: "completed" });
    expect(await pressing(w, await thing(w), "rerun")).toMatchObject({
      alert: true,
      text: expect.stringContaining("GitHub refused"),
    });
    expect(w.net.github("/60/rerun-failed-jobs")).toHaveLength(1);
    expect(await thing(w)).toMatchObject({ state: "failing" });
  });

  it("keep an ignored workflow quiet until a run passes, and page the next failure anew", async () => {
    const w = await world();
    withTopics(w.net);
    await apply(w.context, ran(60, 2));
    expect(await pressing(w, await thing(w), "ignore")).toMatchObject({
      alert: false,
    });
    expect(await thing(w)).toMatchObject({ state: "ignored" });
    const calls = w.net.calls.length;
    expect(await apply(w.context, ran(61, 2))).toBe("workflow ignored");
    expect(w.net.calls).toHaveLength(calls);
    expect(await apply(w.context, ran(62, 1, false))).toBe(
      "workflow recovered",
    );
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toMatch(
      /✅ Green again\.$/,
    );
    // The next failure is a new one, in the topic of the workflow.
    expect(await apply(w.context, ran(63, 2))).toBe("workflow failing");
    const sent = w.net.telegram("sendMessage");
    expect(sent).toHaveLength(2);
    expect(sent.map((call) => call.body.message_thread_id)).toEqual([900, 900]);
    expect(w.net.telegram("createForumTopic")).toHaveLength(1);
    expect(await thing(w)).toMatchObject({ count: 1, state: "failing" });
  });
});

describe("the schedule and a workflow that waits", () => {
  it("shows a failure whose rerun didn't come once its wait is over, as a new message", async () => {
    const w = await world();
    await apply(w.context, ran(60, 1));
    const id = (await thing(w)).id;
    runIs(w, 60, {
      status: "completed",
      conclusion: "failure",
      run_attempt: 1,
    });
    w.clock.now = START + WAIT - 1;
    expect(await runSchedule(w.context)).toEqual([]);
    w.clock.now = START + WAIT;
    expect(await runSchedule(w.context)).toEqual([id]);
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    expect(await thing(w)).toMatchObject({
      state: "failing",
      snoozedUntil: null,
      attempt: 1,
    });
    expect(await runSchedule(w.context)).toEqual([]);
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
  });

  it("waits once more for a rerun that runs, and ends unseen one that passed", async () => {
    const w = await world();
    await apply(w.context, ran(60, 1));
    runIs(w, 60, { status: "in_progress", conclusion: null, run_attempt: 2 });
    w.clock.now = START + WAIT;
    expect(await runSchedule(w.context)).toEqual([]);
    expect(await thing(w)).toMatchObject({
      state: "waiting",
      snoozedUntil: START + 2 * WAIT,
      attempt: 1,
    });
    runIs(w, 60, {
      status: "completed",
      conclusion: "success",
      run_attempt: 2,
    });
    w.clock.now = START + 2 * WAIT;
    expect(await runSchedule(w.context)).toEqual([]);
    expect(await thing(w)).toMatchObject({
      state: "recovered",
      attempt: 2,
      snoozedUntil: null,
    });
    expect(telegram(w)).toEqual([]);
  });

  it("shows a rerun that failed without its event, and a run that GitHub can't tell about", async () => {
    const w = await world();
    await apply(w.context, ran(60, 1));
    await apply(w.context, ran(70, 1, true, ".github/workflows/links.yml"));
    runIs(w, 60, {
      status: "completed",
      conclusion: "failure",
      run_attempt: 2,
    });
    w.clock.now = START + WAIT;
    expect(await runSchedule(w.context)).toHaveLength(2);
    expect(await thing(w)).toMatchObject({
      state: "failing",
      attempt: 2,
      url: `${RUNS}/60`,
    });
    expect(await thing(w, ".github/workflows/links.yml")).toMatchObject({
      state: "failing",
      attempt: 1,
      url: `${RUNS}/70/attempts/1`,
    });
    // A run without its address keeps the one of the failure.
    const w2 = await world();
    await apply(w2.context, ran(60, 1));
    runIs(w2, 60, {
      status: "completed",
      conclusion: "failure",
      run_attempt: 2,
      html_url: undefined,
    });
    w2.clock.now = START + WAIT;
    await runSchedule(w2.context);
    expect(await thing(w2)).toMatchObject({
      attempt: 2,
      url: `${RUNS}/60/attempts/1`,
    });
  });

  it("leaves a workflow for the next run when the calls run out, and one that an event showed since", async () => {
    const w = await world();
    await apply(w.context, ran(60, 1));
    w.clock.now = START + WAIT;
    vi.spyOn(w.context, "subrequests").mockReturnValue(
      SUBREQUESTS - SETTLE + 1,
    );
    expect(await runSchedule(w.context)).toEqual([]);
    expect(await thing(w)).toMatchObject({ state: "waiting" });
    // A record that the list shows as due, but which an event showed since.
    vi.restoreAllMocks();
    await w.context.store.put({ ...(await thing(w)), state: "failing" });
    expect(await runSchedule(w.context)).toEqual([]);
    expect(telegram(w)).toEqual([]);
  });

  it("stops at an error that isn't an answer of GitHub, and the thing waits for the next run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = await world();
    await apply(w.context, ran(60, 1));
    w.clock.now = START + WAIT;
    vi.spyOn(w.context.github, "workflowRun").mockRejectedValue(
      new TypeError("lost"),
    );
    expect(await runSchedule(w.context)).toEqual([]);
    const waiting = await thing(w);
    expect(error).toHaveBeenCalledWith(
      `The schedule failed at the things that come back, thing ${waiting.id}:`,
      "TypeError",
    );
    expect(waiting).toMatchObject({
      state: "waiting",
      snoozedUntil: START + WAIT,
    });
    expect(telegram(w)).toEqual([]);
  });
});

describe("an issue of the bot-health bot", () => {
  const issue = (run?: number): Signal => ({
    ...at,
    type: "health",
    ...(run === undefined ? {} : { run }),
    branch: "main",
    fallback: {
      type: "failing",
      key: "issue:5",
      label: { key: "entry.bot", values: { title: "Docs fails on main" } },
      url: `https://github.com/${REPO}/issues/5`,
      ...(run === undefined ? {} : { run }),
    },
  });

  it("is the end of the run that it names, which a failure that the pager had knows already", async () => {
    const w = await world();
    runIs(w, 60, {
      status: "completed",
      conclusion: "failure",
      run_attempt: 2,
    });
    expect(await apply(w.context, issue(60))).toBe("workflow failing");
    expect(await thing(w)).toMatchObject({ run: 60, attempt: 2 });
    expect(await apply(w.context, issue(60))).toBe("workflow knows the run");
    expect(
      await w.context.store.get(await itemId(keys.alarm(REPO))),
    ).toBeNull();
  });

  it("pages a run that GitHub cancelled at its time limit, and counts it again at an edit", async () => {
    const w = await world();
    runIs(w, 60, {
      status: "completed",
      conclusion: "cancelled",
      run_attempt: 2,
    });
    jobs(w, 60, 2, [["build", "cancelled"]]);
    expect(await apply(w.context, issue(60))).toBe("workflow failing");
    expect(await thing(w)).toMatchObject({ run: 60, attempt: 2, count: 1 });
    runIs(w, 61, {
      status: "completed",
      conclusion: "cancelled",
      run_attempt: 2,
    });
    jobs(w, 61, 2, [["build", "cancelled"]]);
    expect(await apply(w.context, issue(61))).toBe("workflow updated");
    expect(await thing(w)).toMatchObject({ run: 61, count: 2 });
  });

  it("says why the run that it names means nothing", async () => {
    const w = await world();
    runIs(w, 60, { status: "in_progress", conclusion: null });
    expect(await apply(w.context, issue(60))).toBe(
      "the run of the issue: a workflow run that ended ",
    );
  });

  it("is an entry of the alarm, as before, when its run can't be read or it names none", async () => {
    const w = await world();
    expect(await apply(w.context, issue(404))).toBe("alarm opened");
    expect(await apply(w.context, issue())).toBe("alarm updated");
    const alarm = (await w.context.store.get(
      await itemId(keys.alarm(REPO)),
    )) as Alarm;
    expect(alarm.entries).toMatchObject([{ key: "issue:5" }]);
    expect(alarm.entries[0]?.run).toBeUndefined();
  });

  it("stops at an error that isn't an answer of GitHub", async () => {
    const w = await world();
    vi.spyOn(w.context.github, "workflowRun").mockRejectedValue(
      new TypeError("lost"),
    );
    await expect(apply(w.context, issue(60))).rejects.toThrow("lost");
  });
});

describe("the message and the topic of a workflow", () => {
  it("are in the language of the pager, with the red of an alarm", async () => {
    const w = await world({ language: "de" });
    withTopics(w.net);
    jobs(w, 60, 2, [
      ["build", "failure"],
      ["links", "failure"],
    ]);
    await apply(w.context, ran(60, 2));
    w.clock.now = START + 90 * MINUTE;
    await apply(w.context, ran(61, 2));
    expect(w.net.telegram("createForumTopic").map((call) => call.body)).toEqual(
      [
        {
          chat_id: expect.any(Number),
          name: "🔴 Docs in demo",
          icon_color: TOPIC_COLORS.red,
        },
      ],
    );
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      `Gescheitert: <a href="${RUNS}/60/job/1">build</a>, <a href="${RUNS}/60/job/2">links</a>\nGescheitert am 04.11.2026 um 08:00 UTC.`,
    );
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      `🔴 <b>Docs scheitert auf main in <a href="https://github.com/${REPO}">${REPO}</a></b>\n<a href="${RUNS}/61/attempts/2">Der gescheiterte Lauf</a>\n2-mal gescheitert seit dem 04.11.2026 um 08:00 UTC, zuletzt am 04.11.2026 um 09:30 UTC.`,
    );
    await apply(w.context, ran(62, 1, false));
    expect(
      w.net.telegram("editForumTopic").map((call) => call.body.name),
    ).toEqual(["✅ 🔴 Docs in demo"]);
  });

  it("give a text in its topic the run and the logs of the jobs that failed", async () => {
    const w = await world();
    jobs(w, 60, 2, [["build", "failure"]]);
    await apply(w.context, ran(60, 2));
    const told = about(await thing(w), START, texts("en"));
    expect(told).toMatchObject({
      kind: "workflow",
      state: "failing",
      links: [`${RUNS}/60/attempts/2`, `${RUNS}/60/job/1`],
    });
    expect(told.text).toContain("Docs fails on main");
  });
});
