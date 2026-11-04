// What each signal does to the messages: a new one for a new thing, an edit as the
// thing changes, bundles per repository, and the steps of a release.
import { describe, expect, it } from "vitest";

import { apply, show } from "../src/pager.ts";
import type { Signal } from "../src/rules.ts";
import { type Item, itemId, keys } from "../src/store.ts";
import { json, REPO, type World, world } from "./helpers.ts";

const at = { repo: REPO, installation: 9 };

function failing(key: string, label = `${key} fails`): Signal {
  return { ...at, type: "failing", key, label, url: "https://github.com/x" };
}

async function stored(w: World, key: string): Promise<Item | null> {
  return w.context.store.get(await itemId(key));
}

describe("contributions", () => {
  const signal: Signal = {
    ...at,
    type: "contribution",
    number: 12,
    pull: false,
    title: "It breaks",
    url: "https://github.com/Dennis-Otto/demo/issues/12",
    author: "octocat",
  };

  it("get one message each, once", async () => {
    const w = await world();
    expect(await apply(w.context, signal)).toBe("contribution shown");
    expect(await apply(w.context, signal)).toBe("contribution shown already");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    expect(await stored(w, keys.contribution(REPO, 12))).toMatchObject({
      kind: "contribution",
      state: "new",
      messageId: 100,
      draftVersion: 0,
    });
  });
});

describe("the alarm of a repository", () => {
  it("bundles what fails, edits it in place and closes when all is green", async () => {
    const w = await world();
    expect(await apply(w.context, failing("check:lint"))).toBe("alarm opened");
    expect(await apply(w.context, failing("workflow:release"))).toBe(
      "alarm updated",
    );
    expect(
      await apply(w.context, failing("check:lint", "lint fails again")),
    ).toBe("alarm updated");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
    expect(w.net.telegram("editMessageText")).toHaveLength(2);
    const alarm = await stored(w, keys.alarm(REPO));
    expect(alarm).toMatchObject({
      entries: [
        { key: "check:lint", label: "lint fails again" },
        { key: "workflow:release" },
      ],
    });
    expect(
      await apply(w.context, { ...at, type: "recovered", key: "check:other" }),
    ).toBe("not part of the alarm");
    expect(
      await apply(w.context, { ...at, type: "recovered", key: "check:lint" }),
    ).toBe("alarm updated");
    expect(
      await apply(w.context, {
        ...at,
        type: "recovered",
        key: "workflow:release",
      }),
    ).toBe("alarm closed");
    expect(await stored(w, keys.alarm(REPO))).toMatchObject({
      state: "recovered",
      entries: [],
    });
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      "✅ Green again.",
    );
    expect(await apply(w.context, { ...at, type: "recovered", key: "x" })).toBe(
      "no open alarm",
    );
    expect(await apply(w.context, failing("check:lint"))).toBe("alarm opened");
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
  });

  it("counts only the checks that the rules of the branch require", async () => {
    const w = await world();
    w.net.on("GET", "/repos/Dennis-Otto/demo/rules/branches/main", () =>
      json([
        {
          type: "required_status_checks",
          parameters: { required_status_checks: [{ context: "lint" }] },
        },
      ]),
    );
    const check = (name: string, failed: boolean): Signal => ({
      ...at,
      type: "check",
      name,
      failed,
      branch: "main",
      url: "https://github.com/run",
    });
    expect(await apply(w.context, check("docs", true))).toBe(
      "a check that no rule requires",
    );
    expect(await apply(w.context, check("lint", true))).toBe("alarm opened");
    expect(w.net.telegram("sendMessage")[0]?.body.text).toContain(
      "lint fails on main",
    );
    expect(await apply(w.context, check("lint", false))).toBe("alarm closed");
  });
});

describe("code-scanning alerts", () => {
  it("are bundled per repository and resolve one by one", async () => {
    const w = await world();
    const open = (key: string): Signal => ({
      ...at,
      type: "alert-open",
      key,
      label: `high: ${key}`,
      url: "https://github.com/a",
    });
    expect(await apply(w.context, open("alert:1"))).toBe("alert opened");
    expect(await apply(w.context, open("alert:2"))).toBe("alert updated");
    expect(
      await apply(w.context, { ...at, type: "alert-closed", key: "alert:1" }),
    ).toBe("alert updated");
    expect(
      await apply(w.context, { ...at, type: "alert-closed", key: "alert:2" }),
    ).toBe("alert closed");
    expect(await stored(w, keys.alert(REPO))).toMatchObject({
      state: "resolved",
    });
  });
});

describe("a release", () => {
  const pull = {
    number: 30,
    state: "open",
    title: "chore: release 1.2.3",
    draft: false,
    mergeable_state: "clean",
    html_url: "https://github.com/Dennis-Otto/demo/pull/30",
    head: { ref: "release-please--branches--main", sha: "abc" },
    base: { ref: "main", repo: { default_branch: "main" } },
  };
  const check: Signal = { ...at, type: "release-check", numbers: [30] };

  function serve(w: World, answer: object = pull): void {
    w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () => json(answer));
  }

  it("pages once it is ready, and follows it until it is published", async () => {
    const w = await world();
    serve(w, { ...pull, mergeable_state: "blocked" });
    expect(await apply(w.context, check)).toBe(
      "#30 not ready: its checks aren't all green (blocked)",
    );
    serve(w);
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(await apply(w.context, check)).toBe("#30 shown already");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);

    expect(
      await apply(w.context, {
        ...at,
        type: "release-updated",
        number: 30,
        sha: "abc",
      }),
    ).toBe("release unchanged");
    expect(
      await apply(w.context, {
        ...at,
        type: "release-updated",
        number: 30,
        sha: "def",
      }),
    ).toBe("release updating");
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      state: "updating",
      sha: "def",
    });
    serve(w, { ...pull, head: { ...pull.head, sha: "def" } });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.net.telegram("sendMessage")).toHaveLength(1);

    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 31 }),
    ).toBe("release unchanged");
    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 30 }),
    ).toBe("release merged");
    expect(
      await apply(w.context, {
        ...at,
        type: "release-published",
        tag: "v1.2.2",
      }),
    ).toBe("release unchanged");
    expect(
      await apply(w.context, {
        ...at,
        type: "release-published",
        tag: "v1.2.3",
      }),
    ).toBe("release published");
    expect(
      await apply(w.context, {
        ...at,
        type: "release-published",
        tag: "v1.2.3",
      }),
    ).toBe("release unchanged");
    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 30 }),
    ).toBe("release unchanged");
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      state: "published",
    });
    expect(w.net.telegram("editMessageText").at(-1)?.body.text).toContain(
      "✅ Published.",
    );
    // A published release with the same version stays published.
    serve(w);
    expect(await apply(w.context, check)).toBe("#30 shown already");
  });

  it("stays quiet about a release that was ignored, and pages for the next one", async () => {
    const w = await world();
    serve(w);
    await apply(w.context, check);
    const item = (await stored(w, keys.release(REPO))) as Item & {
      state: string;
    };
    item.state = "ignored";
    await w.context.store.put(item);
    expect(await apply(w.context, check)).toBe("#30 ignored");
    serve(w, { ...pull, title: "chore: release 1.3.0" });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
  });

  it("replaces the message of a release whose version changed while it was shown", async () => {
    const w = await world();
    serve(w);
    expect(await apply(w.context, check)).toBe("#30 ready");
    const first = (await stored(w, keys.release(REPO)))?.messageId;
    serve(w, {
      ...pull,
      title: "chore: release 1.3.0",
      head: { ...pull.head, sha: "def" },
    });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.net.telegram("sendMessage")).toHaveLength(2);
    expect(w.net.telegram("deleteMessage")).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ message_id: first }),
      }),
    ]);
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      version: "1.3.0",
      sha: "def",
      state: "ready",
    });
  });

  it("knows no release that it never showed", async () => {
    const w = await world();
    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 30 }),
    ).toBe("no release shown");
    await w.context.store.put({
      id: await itemId(keys.release(REPO)),
      kind: "alarm",
      state: "open",
      repo: REPO,
      installation: 9,
      messageId: null,
      note: null,
      snoozedUntil: null,
      entries: [],
    });
    expect(
      await apply(w.context, { ...at, type: "release-merged", number: 30 }),
    ).toBe("no release shown");
  });

  it("asks again while GitHub works out whether it can merge", async () => {
    const w = await world();
    let asked = 0;
    w.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () => {
      asked += 1;
      return json(asked < 3 ? { ...pull, mergeable_state: "unknown" } : pull);
    });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(w.sleeps).toEqual([2000, 4000]);
    const never = await world();
    never.net.on("GET", "/repos/Dennis-Otto/demo/pulls/30", () =>
      json({ ...pull, mergeable_state: "unknown" }),
    );
    expect(await apply(never.context, check)).toBe(
      "#30 not ready: its checks aren't all green (unknown)",
    );
    expect(never.sleeps).toHaveLength(2);
  });

  it("reads a pull request without its fields as not ready", async () => {
    const w = await world();
    serve(w, {
      number: 30,
      state: "open",
      head: { ref: "release-please--x" },
      base: {},
    });
    expect(await apply(w.context, check)).toBe(
      "#30 not ready: it doesn't go into main",
    );
  });

  it("takes a ready pull request without a head or address as it comes", async () => {
    const w = await world();
    const { html_url: _url, head: _head, ...bare } = pull;
    // A ready pull request always has its head; the rule reads the branch from it.
    serve(w, { ...bare, head: { ref: "release-please--branches--main" } });
    expect(await apply(w.context, check)).toBe("#30 ready");
    expect(await stored(w, keys.release(REPO))).toMatchObject({
      sha: "",
      url: "",
    });
  });
});

describe("showing a thing", () => {
  it("sends a new message when the old one is gone, and replaces it when fresh", async () => {
    const w = await world();
    w.net.on("POST", /editMessageText$/, () =>
      json(
        { ok: false, description: "Bad Request: message to edit not found" },
        400,
      ),
    );
    const item: Item = {
      id: "i0123456789abcde",
      kind: "reminder",
      state: "open",
      repo: REPO,
      installation: 0,
      messageId: 5,
      note: null,
      snoozedUntil: null,
      text: "Hello",
    };
    await show(w.context, item);
    expect(item.messageId).toBe(100);
    expect(w.net.telegram("deleteMessage")).toHaveLength(0);
    await show(w.context, item, true);
    expect(item.messageId).toBe(101);
    expect(w.net.telegram("deleteMessage")[0]?.body.message_id).toBe(100);
  });
});
