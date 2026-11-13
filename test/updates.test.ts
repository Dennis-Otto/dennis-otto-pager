// The updates of Telegram: each button of the allowlist, the edit of a draft, free
// text, and everything that comes from anyone but the maintainer.
import { describe, expect, it } from "vitest";

import { MAX_LABEL } from "../src/actions.ts";
import { allowed, callbackData, headTag, keyboard } from "../src/buttons.ts";
import type {
  Alarm,
  Contribution,
  Item,
  Release,
  Workflow,
} from "../src/store.ts";
import { texts } from "../src/texts.ts";
import { handleUpdate, MAX_TEXT } from "../src/updates.ts";
import {
  base,
  CHAT,
  json,
  REPO,
  START,
  type World,
  withControl,
  world,
} from "./helpers.ts";

const ID = "i0123456789abcde";

function contribution(extra: Partial<Contribution> = {}): Contribution {
  return {
    ...base(ID),
    kind: "contribution",
    state: "new",
    number: 12,
    pull: false,
    title: "It breaks",
    url: "https://github.com/Dennis-Otto/demo/issues/12",
    author: "octocat",
    draft: null,
    draftVersion: 0,
    ...extra,
  };
}

/** The run of a check that fails, in the repository of the alarm. */
const LINT = `https://github.com/${REPO}/actions/runs/7/job/8`;

const alarm: Alarm = {
  ...base(ID),
  kind: "alarm",
  state: "open",
  entries: [{ key: "check:lint", label: "lint fails", url: LINT }],
};

const release: Release = {
  ...base(ID),
  kind: "release",
  state: "ready",
  number: 30,
  version: "1.2.3",
  sha: "abc",
  url: "https://github.com/Dennis-Otto/demo/pull/30",
};

const workflow: Workflow = {
  ...base(ID),
  kind: "workflow",
  state: "failing",
  path: ".github/workflows/ci.yml",
  name: "CI",
  branch: "main",
  run: 5,
  attempt: 1,
  url: `https://github.com/${REPO}/actions/runs/5`,
  jobs: [],
  count: 1,
  since: START,
  last: START,
};

/** Press a button of a thing that is kept already, and return its record after. */
async function pressAgain(w: World, data: string) {
  const outcome = await handleUpdate(w.context, {
    callback_query: { id: "q2", from: { id: CHAT }, data },
  });
  const answer = w.net.telegram("answerCallbackQuery").at(-1)?.body;
  return { outcome, answer, item: await w.context.store.get(ID) };
}

/** GitHub knows the repository of the thing, whose default branch is trunk. */
function withRepository(w: World) {
  w.net.on("GET", "/repos/Dennis-Otto/demo", () =>
    json({ default_branch: "trunk" }),
  );
}

async function pressing(w: World, item: Item, data: string, from = CHAT) {
  await w.context.store.put(item);
  const outcome = await handleUpdate(w.context, {
    callback_query: { id: "q1", from: { id: from }, data },
  });
  const answer = w.net.telegram("answerCallbackQuery").at(-1)?.body;
  return { outcome, answer, item: await w.context.store.get(item.id) };
}

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

/** A message of the maintainer without text, such as a photo or a voice message. */
function media(extra: object) {
  return {
    message: {
      message_id: 500,
      chat: { id: CHAT },
      from: { id: CHAT },
      ...extra,
    },
  };
}

describe("buttons", () => {
  it("put a thing aside with Later", async () => {
    const w = await world();
    const { answer, item } = await pressing(
      w,
      alarm,
      callbackData("later", alarm),
    );
    expect(answer).toMatchObject({ text: "Back in 4 h.", show_alert: false });
    expect(item?.snoozedUntil).toBe(START + 4 * 3600000);
    expect((await w.context.store.pending(START + 4 * 3600000, 0)).due).toEqual(
      [ID],
    );
    expect(w.net.telegram("editMessageText")[0]?.body.text).toContain(
      "⏰ Back in 4 h.",
    );
  });

  it("ignore a thing, and close a reminder with Renewed", async () => {
    const w = await world();
    expect((await pressing(w, alarm, `ignore:${ID}`)).item?.state).toBe(
      "ignored",
    );
    const reminder: Item = {
      ...base(ID),
      kind: "reminder",
      state: "open",
      text: "Renew",
    };
    const done = await pressing(w, reminder, `done:${ID}`);
    expect(done.item?.state).toBe("done");
    expect(done.answer.text).toBe("Done.");
  });

  it("bring an ignored thing back as it was, with its buttons and its topic", async () => {
    const w = await world();
    const name = "🙋 demo#12 It breaks";
    const draft = contribution({
      state: "draft",
      draft: "Thanks!",
      draftVersion: 2,
      topic: { thread: 900, name },
    });
    const ignored = await pressing(w, draft, `ignore:${ID}`);
    expect(ignored.item).toMatchObject({
      state: "ignored",
      ignoredFrom: "draft",
    });
    // Its only button, and a record that expires, as that of every closed thing.
    expect(
      w.net.telegram("editMessageText")[0]?.body.reply_markup,
    ).toMatchObject({
      inline_keyboard: [
        [{ text: "↩️ Bring back", callback_data: `restore:${ID}` }],
      ],
    });
    expect(await w.context.store.unclosed()).toEqual([]);

    const back = await pressAgain(w, `restore:${ID}`);
    expect(back.answer).toMatchObject({
      text: "Brought back.",
      show_alert: false,
    });
    expect(back.item).toMatchObject({ state: "draft", draft: "Thanks!" });
    expect(back.item).not.toHaveProperty("ignoredFrom");
    expect(
      w.net.telegram("editMessageText")[1]?.body.reply_markup,
    ).toMatchObject({ inline_keyboard: keyboard(draft, texts("en")) });
    expect(
      w.net.telegram("editForumTopic").map((call) => call.body.name),
    ).toEqual([`✅ ${name}`, name]);
    expect(await w.context.store.unclosed()).toEqual([ID]);
    // A second press of the old button does nothing.
    expect((await pressAgain(w, `restore:${ID}`)).answer).toMatchObject({
      text: "This button is out of date.",
      show_alert: true,
    });
  });

  it("bring back a thing that waited for a job or a rerun with the button that starts one", async () => {
    const cases: [Item, Item["state"], string][] = [
      [contribution({ state: "drafting", jobStarted: START }), "new", "draft"],
      [{ ...alarm, state: "fixing", jobStarted: START }, "open", "fix"],
      [{ ...workflow, state: "rerunning" }, "failing", "rerun"],
    ];
    for (const [item, state, action] of cases) {
      const w = await world();
      await pressing(w, item, `ignore:${ID}`);
      const { item: back } = await pressAgain(w, `restore:${ID}`);
      expect(back?.state).toBe(state);
      expect(back).not.toHaveProperty("jobStarted");
      expect(allowed(back as Item)).toContain(action);
      // The schedule waits for no answer of the job any more.
      expect((await w.context.store.pending(START, START + 1)).waiting).toEqual(
        [],
      );
    }
  });

  it("bring back a thing ignored before the pager kept how, in its open state", async () => {
    const w = await world();
    const advisory: Item = {
      ...base(ID),
      kind: "advisory",
      state: "ignored",
      ghsa: "GHSA-abcd-efgh-ijkl",
      url: `https://github.com/${REPO}/security/advisories/GHSA-abcd-efgh-ijkl`,
      severity: "high",
      reported: START,
    };
    const pictures: Item = {
      ...base(ID),
      kind: "pictures",
      state: "ignored",
      number: 31,
      title: "New look",
      url: `https://github.com/${REPO}/pull/31`,
      sha: "abc",
      changed: [],
      count: 0,
      shown: 0,
      check: `https://github.com/${REPO}/actions/runs/9`,
    };
    const cases: [Item, Item["state"]][] = [
      [contribution({ state: "ignored" }), "new"],
      [{ ...alarm, state: "ignored" }, "open"],
      [{ ...alarm, kind: "alert", state: "ignored" }, "open"],
      [{ ...workflow, state: "ignored" }, "failing"],
      [{ ...release, state: "ignored" }, "ready"],
      [advisory, "open"],
      [pictures, "open"],
    ];
    for (const [item, state] of cases) {
      const { item: back } = await pressing(w, item, `restore:${ID}`);
      expect(back?.state).toBe(state);
    }
  });

  it("refuse a button that the thing doesn't offer any more", async () => {
    const w = await world();
    const { answer, outcome } = await pressing(
      w,
      { ...alarm, state: "recovered" },
      `fix:${ID}`,
    );
    expect(answer).toMatchObject({
      text: "This button is out of date.",
      show_alert: true,
    });
    expect(outcome).toBe("fix: This button is out of date.");
  });

  it("refuse an unknown button and a thing that is gone", async () => {
    const w = await world();
    expect(
      await handleUpdate(w.context, {
        callback_query: { id: "q", from: { id: CHAT }, data: "rm -rf" },
      }),
    ).toBe("an unknown button");
    expect(
      await handleUpdate(w.context, {
        callback_query: { id: "q", from: { id: CHAT } },
      }),
    ).toBe("an unknown button");
    expect(
      await handleUpdate(w.context, {
        callback_query: { id: "q", from: { id: CHAT }, data: `later:${ID}` },
      }),
    ).toBe("a button of a thing that is gone");
    expect(w.net.telegram("answerCallbackQuery")).toHaveLength(3);
    // A proposal's Confirm for a thing that is gone loses its button.
    expect(
      await handleUpdate(w.context, {
        callback_query: {
          id: "q",
          from: { id: CHAT },
          data: `later:${ID}`,
          message: { message_id: 900 },
        },
      }),
    ).toBe("a button of a thing that is gone");
    expect(w.net.telegram("editMessageReplyMarkup")[0]?.body).toEqual({
      chat_id: CHAT,
      message_id: 900,
      reply_markup: { inline_keyboard: [] },
    });
  });

  it("serve no one but the maintainer", async () => {
    const w = await world();
    const { outcome } = await pressing(w, alarm, `ignore:${ID}`, 1);
    expect(outcome).toBe("a button of a stranger");
    expect(await w.context.store.get(ID)).toMatchObject({ state: "open" });
    expect(w.net.calls).toHaveLength(0);
  });

  describe("Merge", () => {
    const pull = {
      number: 30,
      state: "open",
      title: "chore: release 1.2.3",
      mergeable_state: "clean",
      head: { ref: "release-please--branches--main", sha: "abc" },
      base: { ref: "main", repo: { default_branch: "main" } },
    };

    it("merges a release that is still green at the head it showed", async () => {
      const w = await world();
      w.net
        .on("GET", "/repos/Dennis-Otto/demo/pulls/30", () => json(pull))
        .on("PUT", "/repos/Dennis-Otto/demo/pulls/30/merge", () =>
          json({ merged: true }),
        );
      const { answer, item } = await pressing(
        w,
        release,
        callbackData("merge", release),
      );
      expect(callbackData("merge", release)).toBe(
        `merge:${ID}:${headTag("abc")}`,
      );
      expect(answer.text).toBe("Merging.");
      expect(item?.state).toBe("merging");
      expect(w.net.github("/pulls/30/merge")[0]?.body).toEqual({
        merge_method: "squash",
        sha: "abc",
      });
    });

    it("refuses a button of another head, such as an old proposal's", async () => {
      // Confirm was offered at 1.2.3; the release moved on to 1.3.0 under the same id.
      const w = await world();
      w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () =>
        json({
          ...pull,
          title: "chore: release 1.3.0",
          head: { ...pull.head, sha: "def" },
        }),
      );
      const moved = { ...release, version: "1.3.0", sha: "def" };
      const { answer, item } = await pressing(
        w,
        moved,
        `merge:${ID}:${headTag("abc")}`,
      );
      expect(answer).toMatchObject({
        text: "This release changed since this message: use its newest message.",
        show_alert: true,
      });
      expect(item).toEqual(moved);
      expect(w.net.github("/pulls/30")).toHaveLength(0);
    });

    it("refuses a release that changed since its message", async () => {
      const w = await world();
      w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () =>
        json({ ...pull, head: { ...pull.head, sha: "new" } }),
      );
      const { answer, item } = await pressing(w, release, `merge:${ID}`);
      expect(answer.show_alert).toBe(true);
      expect(item).toMatchObject({ state: "updating", sha: "new" });
      expect(w.net.github("/merge")).toHaveLength(0);
      w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () =>
        json({ number: 30 }),
      );
      const headless = await pressing(w, release, `merge:${ID}`);
      expect(headless.item).toMatchObject({ sha: "" });
    });

    it("refuses a release that isn't green, and says why GitHub refused", async () => {
      const w = await world();
      w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () =>
        json({ ...pull, mergeable_state: "behind", base: { ref: "main" } }),
      );
      const blocked = await pressing(w, release, `merge:${ID}`);
      expect(blocked.answer.text).toBe(
        "Not merged: its checks aren't all green (behind).",
      );
      w.net
        .on("GET", "/repos/Dennis-Otto/demo/pulls/30", () => json(pull))
        .on("PUT", "/repos/Dennis-Otto/demo/pulls/30/merge", () =>
          json({ message: "Head branch was modified" }, 409),
        );
      const refused = await pressing(w, release, `merge:${ID}`);
      expect(refused.answer).toMatchObject({
        text: "GitHub refused: Head branch was modified",
        show_alert: true,
      });
      expect(refused.item?.state).toBe("ready");
    });
  });

  describe("Start fix and Draft a reply", () => {
    it("send the thing to the control repository", async () => {
      const w = await world();
      withControl(w.net).on(
        "POST",
        "/repos/Dennis-Otto/control/dispatches",
        () => new Response(null, { status: 204 }),
      );
      const fixing = await pressing(w, alarm, `fix:${ID}`);
      // The time of the job, after which the schedule gives the buttons back.
      expect(fixing.item).toMatchObject({ state: "fixing", jobStarted: START });
      expect(w.net.github("/dispatches")[0]?.body).toEqual({
        event_type: "pager-fix",
        client_payload: {
          item: ID,
          repo: REPO,
          kind: "alarm",
          entries: [{ label: "lint fails", url: LINT }],
          language: "en",
        },
      });
      const drafting = await pressing(w, contribution(), `draft:${ID}`);
      expect(drafting.item).toMatchObject({
        state: "drafting",
        jobStarted: START,
      });
      expect(w.net.github("/dispatches")[1]?.body).toEqual({
        event_type: "pager-draft",
        client_payload: {
          item: ID,
          repo: REPO,
          number: 12,
          pull: false,
          language: "en",
        },
      });
      expect(w.net.github("/access_tokens")[0]?.body).toEqual({
        repositories: ["control"],
        permissions: { contents: "write" },
      });
    });

    it("explain that the app isn't installed on the control repository", async () => {
      const w = await world();
      const fix = await pressing(w, alarm, `fix:${ID}`);
      expect(fix.answer.text).toContain(
        "isn't installed on Dennis-Otto/control",
      );
      expect(fix.item?.state).toBe("open");
      const draft = await pressing(w, contribution(), `draft:${ID}`);
      expect(draft.item?.state).toBe("new");
      expect(draft.item?.jobStarted).toBeUndefined();
    });

    it("send only what the control repository takes: entries of the repository, each label cut", async () => {
      const w = await world();
      withControl(w.net).on(
        "POST",
        "/repos/Dennis-Otto/control/dispatches",
        () => new Response(null, { status: 204 }),
      );
      // The description of an alert and its path, longer than the control
      // repository takes, an event of GitHub on the app's Advanced page, an entry
      // whose page GitHub didn't name, and one of a repository with a longer name.
      const long = `${"x".repeat(MAX_LABEL - 2)}😀😀`;
      const mixed: Alarm = {
        ...alarm,
        entries: [
          { key: "check:long", label: long, url: LINT },
          {
            key: "delivery:1",
            label: "An event failed",
            url: "https://github.com/settings/apps/pager/advanced",
          },
          { key: "check:nameless", label: "nameless", url: "" },
          {
            key: "check:other",
            label: "other",
            url: `https://github.com/${REPO}-fork/actions/runs/1`,
          },
          ...alarm.entries,
        ],
      };
      const fixing = await pressing(w, mixed, `fix:${ID}`);
      expect(fixing.item?.state).toBe("fixing");
      const sent = w.net.github("/dispatches")[0]?.body.client_payload.entries;
      expect(sent).toEqual([
        { label: `${"x".repeat(MAX_LABEL - 2)}…`, url: LINT },
        { label: "lint fails", url: LINT },
      ]);
      expect(sent[0].label.length).toBeLessThanOrEqual(MAX_LABEL);
    });

    it("start no fix that the control repository would refuse for want of an entry", async () => {
      const w = await world();
      withControl(w.net);
      const foreign: Alarm = {
        ...alarm,
        entries: [
          { key: "check:nameless", label: "nameless", url: "" },
          {
            key: "check:elsewhere",
            label: "elsewhere",
            url: "https://github.com/someone/else/actions/runs/1",
          },
        ],
      };
      const fix = await pressing(w, foreign, `fix:${ID}`);
      expect(fix.answer).toMatchObject({
        text: "Nothing here for Claude to fix: no entry links to a page of its repository.",
        show_alert: true,
      });
      expect(fix.item?.state).toBe("open");
      expect(w.net.github("/dispatches")).toHaveLength(0);
    });
  });

  describe("Rerun", () => {
    const RUNS = `https://github.com/${REPO}/actions/runs`;
    // A bot that fails and its required check, from one run, and a release that
    // fails in another; a check of another app names no run.
    const failed: Alarm = {
      ...alarm,
      entries: [
        {
          key: "issue:5",
          label: "A bot fails: CI fails on main",
          url: `https://github.com/${REPO}/issues/5`,
          run: 31,
        },
        {
          key: "check:lint",
          label: "lint fails on main",
          url: `${RUNS}/31/job/2`,
          run: 31,
        },
        {
          key: "workflow:.github/workflows/release.yml",
          label: "The release fails: Release",
          url: `${RUNS}/40/attempts/1`,
          run: 40,
        },
        { key: "check:other", label: "other", url: "https://github.com/run" },
      ],
    };
    const API = "/repos/Dennis-Otto/demo/actions/runs";

    function runs(w: World, answers: Record<number, object>): void {
      for (const [id, run] of Object.entries(answers)) {
        w.net
          .on("GET", `${API}/${id}`, () => json(run))
          .on(
            "POST",
            `${API}/${id}/rerun-failed-jobs`,
            () => new Response(null, { status: 201 }),
          );
      }
    }

    it("is offered only where an entry names a run, and costs no run of Claude", () => {
      const t = texts("de");
      expect(allowed(alarm)).toEqual(["fix", "later", "ignore"]);
      expect(keyboard(failed, t)).toEqual([
        [
          { text: "🔁 Neu starten", callback_data: `rerun:${ID}` },
          { text: "🛠 Fix starten", callback_data: `fix:${ID}` },
        ],
        [
          { text: "⏰ Später", callback_data: `later:${ID}` },
          { text: "✖ Ignorieren", callback_data: `ignore:${ID}` },
        ],
      ]);
      expect(allowed({ ...failed, state: "fixing" })).toEqual([
        "later",
        "ignore",
      ]);
    });

    it("runs the failed jobs of each run again, once, and says so in the message", async () => {
      const w = await world();
      runs(w, {
        31: { status: "completed", conclusion: "failure" },
        40: { status: "completed", conclusion: "timed_out" },
      });
      const { answer, item } = await pressing(w, failed, `rerun:${ID}`);
      expect(answer).toMatchObject({
        text: "The failed jobs run again: a pass takes the entry out, a failure says so.",
        show_alert: false,
      });
      expect(
        w.net.github("/rerun-failed-jobs").map((call) => call.url),
      ).toEqual([
        `https://api.github.com${API}/31/rerun-failed-jobs`,
        `https://api.github.com${API}/40/rerun-failed-jobs`,
      ]);
      expect(
        w.net.github("/access_tokens").map((call) => call.body.permissions),
      ).toEqual([{ actions: "read" }, { actions: "write" }]);
      expect(item).toMatchObject({
        state: "open",
        entries: [
          { run: 31, rerun: true },
          { run: 31, rerun: true },
          { run: 40, rerun: true },
          { key: "check:other" },
        ],
      });
      expect((item as Alarm).entries[3]).not.toHaveProperty("rerun");
      // The message is edited in place, with its buttons.
      const [edit] = w.net.telegram("editMessageText").map((call) => call.body);
      expect(edit?.message_id).toBe(7);
      expect(edit?.text.match(/🔁 running again…/g)).toHaveLength(3);
      expect(edit?.reply_markup.inline_keyboard[0][0].text).toBe("🔁 Rerun");
    });

    it("does nothing while a run still runs, or once it passed on a retry", async () => {
      const one: Alarm = { ...failed, entries: failed.entries.slice(2) };
      for (const [run, text] of [
        [
          { status: "in_progress", conclusion: null },
          "It still runs, or a newer attempt of it runs: nothing was started.",
        ],
        [{ status: "queued" }, "It still runs"],
        [
          { status: "completed", conclusion: "success" },
          "It passed already on a retry: nothing was started.",
        ],
        // A run without a conclusion counts as failed, and GitHub has the last word.
        [{ status: "completed" }, "GitHub refused: Validation Failed"],
      ] as const) {
        const w = await world();
        runs(w, { 40: run });
        w.net.on("POST", `${API}/40/rerun-failed-jobs`, () =>
          json({ message: "Validation Failed" }, 422),
        );
        const { answer, item } = await pressing(w, one, `rerun:${ID}`);
        expect(answer.text).toContain(text);
        expect(answer.show_alert).toBe(true);
        expect(item).toEqual(one);
        expect(w.net.telegram("editMessageText")).toHaveLength(0);
      }
    });

    it("says why GitHub refused, and still shows the run that it started", async () => {
      const w = await world();
      runs(w, { 31: { status: "completed", conclusion: "failure" } });
      const { answer, item } = await pressing(w, failed, `rerun:${ID}`);
      expect(answer).toMatchObject({
        text: "GitHub refused: Not Found",
        show_alert: true,
      });
      expect(
        (item as Alarm).entries.map((entry) => entry.rerun ?? false),
      ).toEqual([true, true, false, false]);
      expect(w.net.telegram("editMessageText")).toHaveLength(1);
    });

    it("refuses an alarm whose entries name no run", async () => {
      const w = await world();
      const plain = await pressing(w, alarm, `rerun:${ID}`);
      expect(plain.answer.text).toBe("This button is out of date.");
      expect(w.net.github("/rerun-failed-jobs")).toHaveLength(0);
    });
  });

  describe("a proposal of the control repository", () => {
    it("acts once through the thing's own button, and then loses its button", async () => {
      const w = await world();
      await w.context.store.put(alarm);
      const press = (shownIn: number) =>
        handleUpdate(w.context, {
          callback_query: {
            id: "q",
            from: { id: CHAT },
            data: `later:${ID}`,
            message: { message_id: shownIn },
          },
        });
      expect(await press(900)).toMatch(/^later: Back in \d+ h\.$/);
      expect(w.net.telegram("editMessageReplyMarkup")[0]?.body).toEqual({
        chat_id: CHAT,
        message_id: 900,
        reply_markup: { inline_keyboard: [] },
      });
      // The thing's own message keeps its buttons.
      await press(7);
      expect(w.net.telegram("editMessageReplyMarkup")).toHaveLength(1);
    });
  });

  describe("Assistant again", () => {
    it("starts the issue assistant past its rule, in the maintainer's name", async () => {
      const w = await world();
      withRepository(w);
      w.net.on(
        "POST",
        /issue-assistant\.yml\/dispatches$/,
        () => new Response(null, { status: 204 }),
      );
      const { answer, item } = await pressing(
        w,
        contribution(),
        `assistant:${ID}`,
      );
      expect(answer.text).toBe("The issue assistant runs.");
      expect(item?.note).toBe("🤖 The issue assistant answers again.");
      expect(
        w.net.github("/issue-assistant.yml/dispatches")[0]?.body,
      ).toMatchObject({ ref: "trunk" });
    });

    it("shows GitHub's own detail of a refusal that names no override", async () => {
      const w = await world();
      withRepository(w);
      w.net.on("POST", /issue-assistant\.yml\/dispatches$/, () =>
        json({ message: "No ref found for: trunk" }, 422),
      );
      const { answer, item } = await pressing(
        w,
        contribution(),
        `assistant:${ID}`,
      );
      expect(answer.text).toBe("GitHub refused: No ref found for: trunk");
      expect(item?.note).toBeNull();
    });

    it("explains a repository whose assistant doesn't take the override yet", async () => {
      const w = await world();
      withRepository(w);
      w.net.on("POST", /issue-assistant\.yml\/dispatches$/, () =>
        json({ message: 'Unexpected inputs provided: ["override"]' }, 422),
      );
      const { answer } = await pressing(w, contribution(), `assistant:${ID}`);
      expect(answer.text).toContain("doesn't take the override yet");
      w.net.on("POST", /issue-assistant\.yml\/dispatches$/, () =>
        json({ message: "Resource not accessible by integration" }, 403),
      );
      expect(
        (await pressing(w, contribution(), `assistant:${ID}`)).answer.text,
      ).toBe("GitHub refused: Resource not accessible by integration");
    });

    it("explains a repository without an issue assistant", async () => {
      const w = await world();
      withRepository(w);
      w.net.on("POST", /issue-assistant\.yml\/dispatches$/, () =>
        json({ message: "Not Found" }, 404),
      );
      const { answer, item } = await pressing(
        w,
        contribution(),
        `assistant:${ID}`,
      );
      expect(answer.text).toBe(
        "Dennis-Otto/demo has no issue assistant, or GITHUB_USER_TOKEN can't reach it: GitHub knows no workflow issue-assistant.yml there. Nothing was started.",
      );
      expect(item?.note).toBeNull();
    });

    it("lets a stranger's error through to the log", async () => {
      const w = await world();
      withRepository(w);
      w.net.on("POST", /issue-assistant\.yml\/dispatches$/, () => {
        throw new TypeError("network");
      });
      await expect(
        pressing(w, contribution(), `assistant:${ID}`),
      ).rejects.toThrow("network");
      // The press still gets its answer, so its button stops loading.
      expect(w.net.telegram("answerCallbackQuery").at(-1)?.body).toEqual({
        callback_query_id: "q1",
        text: texts("en")("answer.failed"),
        show_alert: true,
      });
    });
  });

  describe("Send and Edit", () => {
    const drafted = contribution({
      state: "draft",
      draft: "Thanks!",
      draftVersion: 2,
    });

    it("posts exactly the draft that the message showed", async () => {
      const w = await world();
      w.net.on("POST", "/repos/Dennis-Otto/demo/issues/12/comments", () =>
        json({ html_url: "https://github.com/c" }, 201),
      );
      const stale = await pressing(w, drafted, `send:${ID}:1`);
      expect(stale.answer.text).toContain("out of date");
      expect(w.net.github("/comments")).toHaveLength(0);
      const sent = await pressing(w, drafted, `send:${ID}:2`);
      expect(sent.item).toMatchObject({
        state: "sent",
        note: "Posted in your name.",
      });
      expect(w.net.github("/comments")[0]?.body).toEqual({ body: "Thanks!" });
      const empty = await pressing(
        w,
        { ...drafted, draft: null },
        `send:${ID}:2`,
      );
      expect(empty.answer.text).toContain("out of date");
    });

    it("replies in a discussion as the app, without the maintainer's token", async () => {
      const w = await world({ userToken: null });
      const answers = [
        { data: { node: { replyTo: null } } },
        { data: { addDiscussionComment: { comment: { id: "DC_9" } } } },
      ];
      w.net.on("POST", "/graphql", () => json(answers.shift()));
      const discussion = contribution({
        state: "draft",
        draft: "Read the README.",
        draftVersion: 2,
        url: "https://github.com/Dennis-Otto/demo/discussions/31#discussioncomment-7",
        discussion: { node: "D_1", comment: "DC_7" },
      });
      const stale = await pressing(w, discussion, `send:${ID}:1`);
      expect(stale.answer.text).toContain("out of date");
      expect(w.net.github("/graphql")).toHaveLength(0);
      const sent = await pressing(w, discussion, `send:${ID}:2`);
      expect(sent.answer.text).toBe("Sent.");
      expect(sent.item).toMatchObject({
        state: "sent",
        note: "Posted in the discussion as the app of the pager.",
      });
      expect(w.net.github("/graphql")[1]?.body.variables).toEqual({
        discussion: "D_1",
        replyTo: "DC_7",
        body: "Read the README.",
      });
      expect(w.net.github("/comments")).toHaveLength(0);

      w.net.on("POST", "/graphql", () =>
        json({ errors: [{ message: "Discussion is locked" }] }),
      );
      const locked = await pressing(w, discussion, `send:${ID}:2`);
      expect(locked.answer).toMatchObject({
        text: "GitHub refused: Discussion is locked",
        show_alert: true,
      });
      expect(locked.item?.state).toBe("draft");
    });

    it("refuses to send without the maintainer's token", async () => {
      const w = await world({ userToken: null });
      const { answer, item } = await pressing(w, drafted, `send:${ID}:2`);
      expect(answer.text).toContain("GITHUB_USER_TOKEN isn't set");
      expect(item?.state).toBe("draft");
    });

    it("takes a new text in reply to its prompt, as the next draft", async () => {
      const w = await world();
      const { answer } = await pressing(w, drafted, `edit:${ID}`);
      expect(answer.text).toBe("Write the new text in reply.");
      expect(await w.context.store.pendingEdit(100)).toEqual({
        item: ID,
        prompt: 100,
      });
      const outcome = await handleUpdate(
        w.context,
        message("  Thank you, fixed in 1.2.3.  ", {
          reply_to_message: { message_id: 100 },
        }),
      );
      expect(outcome).toBe("draft edited");
      expect(await w.context.store.get(ID)).toMatchObject({
        draft: "Thank you, fixed in 1.2.3.",
        draftVersion: 3,
        state: "draft",
        ownDraft: true,
        messageId: 101,
      });
      expect(await w.context.store.pendingEdit(100)).toBeNull();
      const deleted = w.net
        .telegram("deleteMessage")
        .map((call) => call.body.message_id);
      expect(deleted).toEqual([100, 7, 500]);
      const shown = w.net.telegram("sendMessage").at(-1)?.body;
      expect(shown.text).toContain(
        "<blockquote>Thank you, fixed in 1.2.3.</blockquote>",
      );
      expect(shown.reply_markup.inline_keyboard[0][0].callback_data).toBe(
        `send:${ID}:3`,
      );
    });

    it("takes the answer to the prompt of each draft, however many prompts wait", async () => {
      const w = await world();
      const other = contribution({
        ...drafted,
        id: "i0123456789abcdf",
        number: 13,
        url: "https://github.com/Dennis-Otto/demo/issues/13",
        messageId: 8,
        draft: "Thanks too!",
      });
      await pressing(w, drafted, `edit:${ID}`);
      await pressing(w, other, `edit:${other.id}`);
      // Two prompts wait: 100 for the first draft, 101 for the second.
      expect(
        await handleUpdate(
          w.context,
          message("Words for the first.", {
            reply_to_message: { message_id: 100 },
          }),
        ),
      ).toBe("draft edited");
      expect(await w.context.store.get(ID)).toMatchObject({
        draft: "Words for the first.",
        draftVersion: 3,
        ownDraft: true,
      });
      expect(await w.context.store.get(other.id)).toMatchObject({
        draft: "Thanks too!",
        draftVersion: 2,
      });
      // No run of the control repository for a text that was a draft.
      expect(w.net.github("/dispatches")).toHaveLength(0);
      expect(await w.context.store.pendingEdit(100)).toBeNull();
      expect(await w.context.store.pendingEdit(101)).toEqual({
        item: other.id,
        prompt: 101,
      });
      expect(
        await handleUpdate(
          w.context,
          message("Words for the second.", {
            reply_to_message: { message_id: 101 },
          }),
        ),
      ).toBe("draft edited");
      expect(await w.context.store.get(other.id)).toMatchObject({
        draft: "Words for the second.",
        draftVersion: 3,
      });
      expect(w.net.github("/dispatches")).toHaveLength(0);
      const deleted = w.net
        .telegram("deleteMessage")
        .map((call) => call.body.message_id);
      expect(deleted).toEqual(expect.arrayContaining([100, 101]));
    });

    it("takes the answer to an earlier prompt of the same draft", async () => {
      const w = await world();
      await pressing(w, drafted, `edit:${ID}`);
      await pressing(w, drafted, `edit:${ID}`);
      expect(
        await handleUpdate(
          w.context,
          message("From the first prompt.", {
            reply_to_message: { message_id: 100 },
          }),
        ),
      ).toBe("draft edited");
      expect(await w.context.store.get(ID)).toMatchObject({
        draft: "From the first prompt.",
        ownDraft: true,
      });
      expect(w.net.github("/dispatches")).toHaveLength(0);
    });

    it("keeps a text that comes while a newer comment is drafted, as the maintainer's own", async () => {
      const w = await world();
      const asked = contribution({
        ...drafted,
        discussion: { node: "D_1", comment: "DC_7" },
      });
      await pressing(w, asked, `edit:${ID}`);
      // A new comment came after the press, and its draft is being written.
      await w.context.store.put({
        ...asked,
        state: "drafting",
        draft: null,
        jobStarted: 5,
        discussion: { node: "D_1", comment: "DC_8", redraft: true },
      });
      expect(
        await handleUpdate(
          w.context,
          message("My own words.", { reply_to_message: { message_id: 100 } }),
        ),
      ).toBe("draft edited");
      const kept = await w.context.store.get(ID);
      expect(kept).toMatchObject({
        state: "draft",
        draft: "My own words.",
        ownDraft: true,
        discussion: { node: "D_1", comment: "DC_8" },
      });
      // The pager waits for no job any more: its draft no longer replaces this one.
      expect(kept).not.toHaveProperty("jobStarted");
      expect(kept).not.toHaveProperty("discussion.redraft");
    });

    it("keeps a text that comes while a newer comment of an issue is drafted, as the maintainer's own", async () => {
      const w = await world();
      const asked = contribution({
        ...drafted,
        comment: { id: 99, noticed: 1 },
      });
      await pressing(w, asked, `edit:${ID}`);
      await w.context.store.put({
        ...asked,
        state: "drafting",
        draft: null,
        jobStarted: 5,
        comment: { id: 100, noticed: 1, redraft: true },
      });
      expect(
        await handleUpdate(
          w.context,
          message("My own words.", { reply_to_message: { message_id: 100 } }),
        ),
      ).toBe("draft edited");
      const kept = await w.context.store.get(ID);
      expect(kept).toMatchObject({
        state: "draft",
        ownDraft: true,
        comment: { id: 100, noticed: 1 },
      });
      expect(kept).not.toHaveProperty("jobStarted");
      expect(kept).not.toHaveProperty("comment.redraft");
    });

    it("refuses an edit that is too long, or of a draft that is gone", async () => {
      const w = await world();
      await pressing(w, drafted, `edit:${ID}`);
      const reply = {
        reply_to_message: { message_id: 100 },
        message_thread_id: 77,
      };
      expect(
        await handleUpdate(w.context, message("x".repeat(3001), reply)),
      ).toBe("an edit that is too long");
      expect(await w.context.store.get(ID)).toMatchObject({ draftVersion: 2 });
      // The answer goes into the thread of the reply, the draft stays where it is.
      expect(w.net.telegram("sendMessage").at(-1)?.body).toMatchObject({
        text: expect.stringContaining("3001 characters"),
        message_thread_id: 77,
      });
      await pressing(w, drafted, `edit:${ID}`);
      // The prompt is the message that the press sent last.
      const prompt = w.net.lastMessageId;
      expect(await w.context.store.pendingEdit(prompt)).toEqual({
        item: ID,
        prompt,
      });
      await w.context.store.put({ ...drafted, state: "sent" });
      expect(
        await handleUpdate(
          w.context,
          message("New", {
            reply_to_message: { message_id: prompt },
            message_thread_id: 78,
          }),
        ),
      ).toBe("an edit of a draft that is gone");
      expect(w.net.telegram("sendMessage").at(-1)?.body).toMatchObject({
        text: "That draft is gone; nothing changed.",
        message_thread_id: 78,
      });
      await w.context.store.setPendingEdit({
        item: "i000000000000000",
        prompt: 9,
      });
      expect(
        await handleUpdate(
          w.context,
          message("New", { reply_to_message: { message_id: 9 } }),
        ),
      ).toBe("an edit of a draft that is gone");
    });
  });
});

describe("an action that went through on GitHub", () => {
  const t = texts("en");

  /**
   * A Telegram that takes the press but no change of its message: a 5xx of its
   * servers, a 429 that asks to wait longer than the pager does, or no answer.
   */
  function refusingEdits(w: World, how: "502" | "429" | "unreachable"): void {
    w.net.on("POST", /\/editMessageText$/, () => {
      if (how === "unreachable") {
        throw new TypeError("fetch failed");
      }
      return how === "502"
        ? json({ ok: false, error_code: 502, description: "Bad Gateway" }, 502)
        : json(
            {
              ok: false,
              error_code: 429,
              description: "Too Many Requests: retry after 30",
              parameters: { retry_after: 30 },
            },
            429,
          );
    });
  }

  /** Press the button again, on what the pager kept of the first press. */
  async function again(w: World, data: string) {
    await handleUpdate(w.context, {
      callback_query: { id: "q2", from: { id: CHAT }, data },
    });
    return w.net.telegram("answerCallbackQuery").at(-1)?.body;
  }

  const outdated = { text: t("answer.outdated"), show_alert: true };

  it("posts a reply in a discussion once, though Telegram refused to show it", async () => {
    const w = await world({ userToken: null });
    refusingEdits(w, "502");
    w.net.on("POST", "/graphql", () =>
      json({ data: { addDiscussionComment: { comment: { id: "DC_9" } } } }),
    );
    const discussion = contribution({
      state: "draft",
      draft: "Read the README.",
      draftVersion: 2,
      url: "https://github.com/Dennis-Otto/demo/discussions/31",
      discussion: { node: "D_1" },
    });
    const sent = await pressing(w, discussion, `send:${ID}:2`);
    expect(w.net.telegram("editMessageText")).toHaveLength(1);
    expect(sent.answer).toMatchObject({ text: "Sent.", show_alert: false });
    expect(sent.item).toMatchObject({
      state: "sent",
      note: "Posted in the discussion as the app of the pager.",
      messageId: 7,
    });
    expect(await again(w, `send:${ID}:2`)).toMatchObject(outdated);
    expect(w.net.github("/graphql")).toHaveLength(1);
  });

  it("posts a comment once, though Telegram asked to wait too long", async () => {
    const w = await world();
    refusingEdits(w, "429");
    w.net.on("POST", "/repos/Dennis-Otto/demo/issues/12/comments", () =>
      json({ html_url: "https://github.com/c" }, 201),
    );
    const drafted = contribution({
      state: "draft",
      draft: "Thanks!",
      draftVersion: 2,
    });
    const sent = await pressing(w, drafted, `send:${ID}:2`);
    expect(sent.answer.text).toBe("Sent.");
    expect(sent.item).toMatchObject({ state: "sent" });
    expect(await again(w, `send:${ID}:2`)).toMatchObject(outdated);
    expect(w.net.github("/comments")).toHaveLength(1);
  });

  it("starts a fix and asks for a draft once, though Telegram can't be reached", async () => {
    const w = await world();
    refusingEdits(w, "unreachable");
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    const fixing = await pressing(w, alarm, `fix:${ID}`);
    expect(fixing.answer).toMatchObject({
      text: t("answer.fixing"),
      show_alert: false,
    });
    expect(fixing.item).toMatchObject({ state: "fixing", jobStarted: START });
    expect(await again(w, `fix:${ID}`)).toMatchObject(outdated);
    const drafting = await pressing(w, contribution(), `draft:${ID}`);
    expect(drafting.answer.text).toBe(t("answer.drafting"));
    expect(drafting.item).toMatchObject({ state: "drafting" });
    expect(await again(w, `draft:${ID}`)).toMatchObject(outdated);
    expect(
      w.net.github("/dispatches").map((call) => call.body.event_type),
    ).toEqual(["pager-fix", "pager-draft"]);
  });

  it("merges a release once, though Telegram refused to show it", async () => {
    const w = await world();
    refusingEdits(w, "502");
    w.net
      .on("GET", "/repos/Dennis-Otto/demo/pulls/30", () =>
        json({
          number: 30,
          state: "open",
          title: "chore: release 1.2.3",
          mergeable_state: "clean",
          head: { ref: "release-please--branches--main", sha: "abc" },
          base: { ref: "main", repo: { default_branch: "main" } },
        }),
      )
      .on("PUT", "/repos/Dennis-Otto/demo/pulls/30/merge", () =>
        json({ merged: true }),
      );
    const data = callbackData("merge", release);
    const merging = await pressing(w, release, data);
    expect(merging.answer.text).toBe("Merging.");
    expect(merging.item).toMatchObject({ state: "merging" });
    expect(await again(w, data)).toMatchObject(outdated);
    expect(w.net.github("/pulls/30/merge")).toHaveLength(1);
  });

  it("keeps what the issue assistant and a rerun did, though Telegram refused to show it", async () => {
    const w = await world();
    refusingEdits(w, "502");
    withRepository(w);
    w.net
      .on(
        "POST",
        /issue-assistant\.yml\/dispatches$/,
        () => new Response(null, { status: 204 }),
      )
      .on("GET", "/repos/Dennis-Otto/demo/actions/runs/31", () =>
        json({ status: "completed", conclusion: "failure" }),
      )
      .on(
        "POST",
        "/repos/Dennis-Otto/demo/actions/runs/31/rerun-failed-jobs",
        () => new Response(null, { status: 201 }),
      );
    const assisted = await pressing(w, contribution(), `assistant:${ID}`);
    expect(assisted.answer.text).toBe("The issue assistant runs.");
    expect(assisted.item?.note).toBe("🤖 The issue assistant answers again.");
    const failing: Alarm = {
      ...alarm,
      entries: [{ ...alarm.entries[0], run: 31 }] as Alarm["entries"],
    };
    const rerun = await pressing(w, failing, `rerun:${ID}`);
    expect(rerun.answer.text).toBe(t("answer.rerun"));
    expect(rerun.item).toMatchObject({ entries: [{ run: 31, rerun: true }] });
  });

  it("still acts and keeps nothing when the message failed before GitHub was asked", async () => {
    // Later changes nothing on GitHub: a press that Telegram can't show stays
    // unsaved, and the next press puts the thing aside again.
    const w = await world();
    refusingEdits(w, "502");
    await expect(pressing(w, alarm, `later:${ID}`)).rejects.toThrow(
      "Bad Gateway",
    );
    expect(await w.context.store.get(ID)).toMatchObject({ snoozedUntil: null });
    // Its answer says that it failed, rather than a button that loads until
    // Telegram gives up.
    expect(w.net.telegram("answerCallbackQuery")).toHaveLength(1);
    expect(w.net.telegram("answerCallbackQuery")[0]?.body).toEqual({
      callback_query_id: "q1",
      text: t("answer.failed"),
      show_alert: true,
    });
  });

  it("answers a press whose edit Telegram fails with a 500", async () => {
    const w = await world();
    w.net.on("POST", /\/editMessageText$/, () =>
      json(
        { ok: false, error_code: 500, description: "Internal Server Error" },
        500,
      ),
    );
    await expect(pressing(w, alarm, `ignore:${ID}`)).rejects.toThrow(
      "Internal Server Error",
    );
    expect(w.net.telegram("answerCallbackQuery").at(-1)?.body).toMatchObject({
      text: t("answer.failed"),
      show_alert: true,
    });
  });

  it("answers a press whose thing can't be read, and logs the first error", async () => {
    const w = await world();
    await w.context.store.put(alarm);
    w.context.store.get = () => Promise.reject(new TypeError("KV failed"));
    await expect(
      handleUpdate(w.context, {
        callback_query: { id: "q1", from: { id: CHAT }, data: `later:${ID}` },
      }),
    ).rejects.toThrow("KV failed");
    expect(w.net.telegram("answerCallbackQuery").at(-1)?.body).toMatchObject({
      text: t("answer.failed"),
      show_alert: true,
    });
  });

  it("throws the error of the press when Telegram takes no answer either", async () => {
    const w = await world();
    refusingEdits(w, "502");
    w.net.on("POST", /\/answerCallbackQuery$/, () =>
      json({ ok: false, error_code: 502, description: "Bad Gateway" }, 502),
    );
    await expect(pressing(w, alarm, `later:${ID}`)).rejects.toThrow(
      "editMessageText",
    );
    expect(w.net.telegram("answerCallbackQuery")).toHaveLength(1);
  });

  it("answers once, though what follows its answer fails", async () => {
    // A proposal's button goes after the answer: a failure there needs no second
    // answer, which Telegram would refuse anyway.
    const w = await world();
    w.net.on("POST", /\/editMessageReplyMarkup$/, () => {
      throw new TypeError("fetch failed");
    });
    await w.context.store.put(alarm);
    await expect(
      handleUpdate(w.context, {
        callback_query: {
          id: "q1",
          from: { id: CHAT },
          data: `later:${ID}`,
          message: { message_id: 99 },
        },
      }),
    ).rejects.toThrow("fetch failed");
    expect(
      w.net.telegram("answerCallbackQuery").map((call) => call.body.text),
    ).toEqual([t("answer.later", { hours: 4 })]);
  });
});

describe("messages", () => {
  it("answer /start and /help", async () => {
    const w = await world();
    expect(await handleUpdate(w.context, message("/start"))).toBe("help");
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "This is your pager.",
    );
  });

  it("answer in the thread of the message, and in the main view without one", async () => {
    const w = await world();
    const topic = { message_thread_id: 77, is_topic_message: true };
    expect(await handleUpdate(w.context, message("/help", topic))).toBe("help");
    // General, the first thread, takes its messages without an id, as the Bot API asks.
    await handleUpdate(w.context, message("/help", { message_thread_id: 1 }));
    await handleUpdate(w.context, message("/help"));
    const sent = w.net.telegram("sendMessage").map((call) => call.body);
    expect(sent.map((body) => body.message_thread_id)).toEqual([
      77,
      undefined,
      undefined,
    ]);
    expect(sent.filter((body) => "message_thread_id" in body)).toHaveLength(1);
  });

  it("answer a free text that the control repository would refuse, and send none", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    // A pasted log, longer than the control repository takes but not than
    // Telegram's 4096 characters; the longest one it takes goes on.
    expect(
      await handleUpdate(
        w.context,
        message("x".repeat(MAX_TEXT + 1), { message_thread_id: 77 }),
      ),
    ).toBe("free text that is too long");
    expect(w.net.github("/dispatches")).toHaveLength(0);
    expect(w.net.telegram("setMessageReaction")).toHaveLength(0);
    expect(await w.context.store.waiting(START + 1)).toEqual([]);
    expect(w.net.telegram("sendMessage")[0]?.body).toMatchObject({
      text: `That text has ${MAX_TEXT + 1} characters; the control repository takes ${MAX_TEXT} at most. Send a shorter one.`,
      message_thread_id: 77,
    });
    expect(await handleUpdate(w.context, message("x".repeat(MAX_TEXT)))).toBe(
      "free text sent",
    );
    expect(
      w.net.github("/dispatches")[0]?.body.client_payload.text,
    ).toHaveLength(MAX_TEXT);
  });

  it("send free text to the control repository and react to it", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    expect(await handleUpdate(w.context, message("What failed tonight?"))).toBe(
      "free text sent",
    );
    expect(w.net.github("/dispatches")[0]?.body).toEqual({
      event_type: "pager-text",
      client_payload: {
        text: "What failed tonight?",
        message: 500,
        language: "en",
      },
    });
    expect(w.net.telegram("setMessageReaction")[0]?.body.reaction).toEqual([
      { type: "emoji", emoji: "👀" },
    ]);
    // It waits for its answer, which turns the 👀 into 👍, or the schedule into 😢.
    expect(await w.context.store.waiting(START + 1)).toEqual([500]);
    expect(await w.context.store.waiting(START)).toEqual([]);
    // A text without a thread gets its answer in the main view.
    expect(await w.context.store.thread(500)).toBeNull();
  });

  it("say at once in its thread that a free text GitHub refused never left", async () => {
    const w = await world();
    withControl(w.net).on("POST", "/repos/Dennis-Otto/control/dispatches", () =>
      json({ message: "Server <Error>" }, 500),
    );
    const topic = { message_thread_id: 77, is_topic_message: true };
    expect(await handleUpdate(w.context, message("Status?", topic))).toBe(
      "free text that GitHub refused",
    );
    expect(w.net.telegram("sendMessage").map((call) => call.body)).toEqual([
      expect.objectContaining({
        message_thread_id: 77,
        text: texts("en")("chat.notSent", { detail: "Server &lt;Error&gt;" }),
      }),
    ]);
    expect(
      w.net.telegram("setMessageReaction").map((call) => call.body.reaction),
    ).toEqual([[{ type: "emoji", emoji: "😢" }]]);
    // No 👀 and no waiting text, which the schedule would mark a second time.
    expect(await w.context.store.waiting(START + 1)).toEqual([]);
    expect(await w.context.store.thread(500)).toBeNull();
  });

  it("say so too when GitHub refuses to find the app on the control repository", async () => {
    const w = await world();
    w.net.on("GET", "/repos/Dennis-Otto/control/installation", () =>
      json({ message: "Bad credentials" }, 401),
    );
    expect(await handleUpdate(w.context, message("Status?"))).toBe(
      "free text that GitHub refused",
    );
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "GitHub refused: Bad credentials.",
    );
    expect(w.net.github("/dispatches")).toHaveLength(0);
    expect(await w.context.store.waiting(START + 1)).toEqual([]);
  });

  it("keep the thread of a free text for its answer, which the reaction needs not", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    const topic = { message_thread_id: 77, is_topic_message: true };
    expect(await handleUpdate(w.context, message("Status?", topic))).toBe(
      "free text sent",
    );
    // The control repository gets what it got before: the thread stays with the pager.
    expect(w.net.github("/dispatches")[0]?.body.client_payload).toEqual({
      text: "Status?",
      message: 500,
      language: "en",
    });
    expect(w.net.telegram("setMessageReaction")[0]?.body).toEqual({
      chat_id: CHAT,
      message_id: 500,
      reaction: [{ type: "emoji", emoji: "👀" }],
    });
    expect(await w.context.store.thread(500)).toBe(77);
    expect(await w.context.store.waiting(START + 1)).toEqual([500]);
    // A text from General gets its answer in the main view, which is General.
    await handleUpdate(
      w.context,
      message("And now?", { message_id: 501, message_thread_id: 1 }),
    );
    expect(await w.context.store.thread(501)).toBeNull();
    expect(await w.context.store.thread(9)).toBeNull();
  });

  it("explain a missing control repository in the thread of the text", async () => {
    const w = await world();
    const topic = { message_thread_id: 77, is_topic_message: true };
    expect(await handleUpdate(w.context, message("Status?", topic))).toBe(
      "free text without a control repository",
    );
    expect(w.net.telegram("sendMessage")[0]?.body).toMatchObject({
      message_thread_id: 77,
    });
    expect(await w.context.store.waiting(START + 1)).toEqual([]);
  });

  it("explain a free text that GitHub refuses, with 😢, in its thread", async () => {
    const w = await world();
    withControl(w.net).on("POST", "/repos/Dennis-Otto/control/dispatches", () =>
      json({ message: "Resource not accessible by integration" }, 403),
    );
    const topic = { message_thread_id: 77, is_topic_message: true };
    expect(await handleUpdate(w.context, message("Status?", topic))).toBe(
      "free text that GitHub refused",
    );
    expect(w.net.telegram("sendMessage")[0]?.body).toMatchObject({
      message_thread_id: 77,
      text: texts("en")("chat.notSent", {
        detail: "Resource not accessible by integration",
      }),
    });
    expect(
      w.net.telegram("setMessageReaction").map((call) => call.body.reaction),
    ).toEqual([[{ type: "emoji", emoji: "😢" }]]);
    // It reached no run, so no answer is waited for.
    expect(await w.context.store.waiting(START + 1)).toEqual([]);
  });

  it("react with 😢 to a text whose handling fails, and log its error", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => {
        throw new TypeError("fetch failed");
      },
    );
    const topic = { message_thread_id: 77, is_topic_message: true };
    await expect(
      handleUpdate(w.context, message("Status?", topic)),
    ).rejects.toThrow("fetch failed");
    expect(
      w.net.telegram("setMessageReaction").map((call) => call.body.reaction),
    ).toEqual([[{ type: "emoji", emoji: "😢" }]]);
    expect(w.net.telegram("sendMessage")[0]?.body).toMatchObject({
      message_thread_id: 77,
      text: texts("en")("chat.failed"),
    });
    expect(await w.context.store.waiting(START + 1)).toEqual([]);
  });

  it("throw the error of a text when Telegram takes nothing more either", async () => {
    const w = await world();
    w.net.on("POST", /\/sendMessage$/, () =>
      json(
        { ok: false, error_code: 500, description: "Internal Server Error" },
        500,
      ),
    );
    await expect(handleUpdate(w.context, message("/help"))).rejects.toThrow(
      "Internal Server Error",
    );
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
    expect(w.net.telegram("setMessageReaction")).toHaveLength(1);
  });

  it("tell a text that reached its run not to be written again when its 👀 fails", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    // A reaction that Telegram refuses passes; one that never reaches it throws.
    w.net.on("POST", /\/setMessageReaction$/, () => {
      throw new TypeError("network");
    });
    await expect(
      handleUpdate(w.context, message("What failed tonight?")),
    ).rejects.toThrow("network");
    expect(w.net.github("/dispatches")).toHaveLength(1);
    // Its run has started, and its answer can still come: no 😢, and no message
    // that asks for the text again, which would start a second run of Claude.
    expect(
      w.net.telegram("setMessageReaction").map((call) => call.body.reaction),
    ).toEqual([[{ type: "emoji", emoji: "👀" }]]);
    expect(w.net.telegram("sendMessage")).toEqual([]);
  });

  it("send the message that a free text answers along, as its context", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    const answered = `📦 Release 1.2.3 of ${REPO}: #30 ${"x".repeat(1200)}`;
    await handleUpdate(
      w.context,
      message("Merge it", {
        reply_to_message: { message_id: 30, text: ` ${answered} ` },
      }),
    );
    await handleUpdate(
      w.context,
      message("And this?", {
        reply_to_message: { message_id: 31, text: "  " },
      }),
    );
    const payloads = w.net
      .github("/dispatches")
      .map((call) => call.body.client_payload);
    expect(payloads[0]).toEqual({
      text: "Merge it",
      message: 500,
      reply: answered.slice(0, 1000),
      language: "en",
    });
    expect(payloads[1]).toEqual({
      text: "And this?",
      message: 500,
      language: "en",
    });
  });

  it("send the words below a photo or a file as a text", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    const photo = [{ file_id: "p1", width: 90, height: 60 }];
    const shown = { photo, caption: " Is this the bug they mean? " };
    expect(await handleUpdate(w.context, media(shown))).toBe("free text sent");
    const file = { file_id: "d1", file_name: "run.log" };
    await handleUpdate(w.context, media({ document: file, caption: "Why?" }));
    expect(
      w.net.github("/dispatches").map((call) => call.body.client_payload),
    ).toEqual([
      { text: "Is this the bug they mean?", message: 500, language: "en" },
      { text: "Why?", message: 500, language: "en" },
    ]);
    expect(w.net.telegram("setMessageReaction")).toHaveLength(2);
    // Its text decides when a message has both, as Telegram never sends.
    await handleUpdate(w.context, message("Text", { caption: "Caption" }));
    expect(w.net.github("/dispatches")[2]?.body.client_payload.text).toBe(
      "Text",
    );
  });

  it("send the caption of a picture that a text answers along, as its context", async () => {
    const w = await world();
    withControl(w.net).on(
      "POST",
      "/repos/Dennis-Otto/control/dispatches",
      () => new Response(null, { status: 204 }),
    );
    await handleUpdate(
      w.context,
      message("Is that blue?", {
        reply_to_message: { message_id: 30, caption: " After: home.png " },
      }),
    );
    expect(w.net.github("/dispatches")[0]?.body.client_payload).toEqual({
      text: "Is that blue?",
      message: 500,
      reply: "After: home.png",
      language: "en",
    });
  });

  it("answer a photo, a file or a voice message without words in its thread", async () => {
    const w = await world();
    const topic = { message_thread_id: 77, is_topic_message: true };
    const photo = [{ file_id: "p1", width: 90, height: 60 }];
    expect(await handleUpdate(w.context, media({ photo, ...topic }))).toBe(
      "a message without words",
    );
    const voice = { file_id: "v1", duration: 4 };
    expect(await handleUpdate(w.context, media({ voice }))).toBe(
      "a message without words",
    );
    const file = { file_id: "d1", file_name: "run.log" };
    expect(
      await handleUpdate(w.context, media({ document: file, caption: "  " })),
    ).toBe("a message without words");
    const sent = w.net.telegram("sendMessage").map((call) => call.body);
    expect(sent.map((body) => body.text)).toEqual(
      Array(3).fill(texts("en")("chat.textOnly")),
    );
    expect(sent.map((body) => body.message_thread_id)).toEqual([
      77,
      undefined,
      undefined,
    ]);
    // Nothing went to the control repository, and nothing waits for an answer.
    expect(w.net.github("/dispatches")).toHaveLength(0);
    expect(w.net.telegram("setMessageReaction")).toHaveLength(0);
    expect(await w.context.store.waiting(START + 1)).toEqual([]);
  });

  it("drop the service message of a topic and one of a stranger's photo without an answer", async () => {
    const w = await world();
    const renamed = { forum_topic_edited: { name: "Mine" } };
    expect(await handleUpdate(w.context, media(renamed))).toBe(
      "a message without text",
    );
    const photo = [{ file_id: "p1", width: 90, height: 60 }];
    expect(
      await handleUpdate(w.context, media({ photo, from: { id: 1 } })),
    ).toBe("a message of a stranger");
    expect(w.net.calls).toHaveLength(0);
  });

  it("send a text that answers no prompt as free text", async () => {
    const w = await world();
    await w.context.store.setPendingEdit({ item: ID, prompt: 9 });
    expect(
      await handleUpdate(
        w.context,
        message("Hello", { reply_to_message: { message_id: 8 } }),
      ),
    ).toBe("free text without a control repository");
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "isn't installed yet",
    );
  });

  it("drop what comes from others, or without text", async () => {
    const w = await world();
    expect(await handleUpdate(w.context, {})).toBe(
      "an update without a message",
    );
    expect(
      await handleUpdate(w.context, {
        message: {
          message_id: 1,
          chat: { id: CHAT },
          from: { id: 1 },
          text: "hi",
        },
      }),
    ).toBe("a message of a stranger");
    expect(
      await handleUpdate(w.context, {
        message: {
          message_id: 1,
          chat: { id: -100 },
          from: { id: CHAT },
          text: "hi",
        },
      }),
    ).toBe("a message of a stranger");
    expect(await handleUpdate(w.context, { message: { message_id: 1 } })).toBe(
      "a message of a stranger",
    );
    expect(await handleUpdate(w.context, message("   "))).toBe(
      "a message without text",
    );
    expect(
      await handleUpdate(w.context, {
        message: { message_id: 1, chat: { id: CHAT }, from: { id: CHAT } },
      }),
    ).toBe("a message without text");
    expect(w.net.calls).toHaveLength(0);
  });
});
