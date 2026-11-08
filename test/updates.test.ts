// The updates of Telegram: each button of the allowlist, the edit of a draft, free
// text, and everything that comes from anyone but the maintainer.
import { describe, expect, it } from "vitest";

import { allowed, callbackData, headTag, keyboard } from "../src/buttons.ts";
import type { Alarm, Contribution, Item, Release } from "../src/store.ts";
import { texts } from "../src/texts.ts";
import { handleUpdate } from "../src/updates.ts";
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

const alarm: Alarm = {
  ...base(ID),
  kind: "alarm",
  state: "open",
  entries: [
    { key: "check:lint", label: "lint fails", url: "https://github.com/run" },
  ],
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
          entries: [{ label: "lint fails", url: "https://github.com/run" }],
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
    });

    it("explains a repository whose assistant doesn't take the override yet", async () => {
      const w = await world();
      w.net.on("POST", /issue-assistant\.yml\/dispatches$/, () =>
        json({ message: 'Unexpected inputs provided: ["override"]' }, 422),
      );
      const { answer } = await pressing(w, contribution(), `assistant:${ID}`);
      expect(answer.text).toContain("doesn't take the override yet");
      w.net.on("POST", /issue-assistant\.yml\/dispatches$/, () =>
        json({ message: "Not Found" }, 404),
      );
      expect(
        (await pressing(w, contribution(), `assistant:${ID}`)).answer.text,
      ).toBe("GitHub refused: Not Found");
    });

    it("lets a stranger's error through to the log", async () => {
      const w = await world();
      w.net.on("POST", /issue-assistant\.yml\/dispatches$/, () => {
        throw new TypeError("network");
      });
      await expect(
        pressing(w, contribution(), `assistant:${ID}`),
      ).rejects.toThrow("network");
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
      expect(await w.context.store.pendingEdit()).toEqual({
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
      expect(await w.context.store.pendingEdit()).toBeNull();
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
      const prompt = (await w.context.store.pendingEdit())?.prompt;
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
