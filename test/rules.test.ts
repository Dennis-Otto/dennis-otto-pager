// The rules of what counts, event by event: each kind of event that pages the
// maintainer, and each reason why one doesn't.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  checkRunOf,
  classify,
  healthRun,
  isBot,
  isMaintainer,
  isRequired,
  type Payload,
  releaseBlocker,
  releaseVersion,
} from "../src/rules.ts";
import { texts } from "../src/texts.ts";

const ME = "Dennis-Otto";
const en = texts("en");

/** Why a release may not merge, in English words, or null. */
function why(...args: Parameters<typeof releaseBlocker>): string | null {
  const blocker = releaseBlocker(...args);
  return blocker === null ? null : en.phrase(blocker);
}
const repository = {
  full_name: "Dennis-Otto/demo",
  default_branch: "main",
  owner: { login: "Dennis-Otto", type: "User" },
};
const at = { repo: "Dennis-Otto/demo", installation: 9 };

function event(extra: Payload): Payload {
  return { repository, installation: { id: 9 }, ...extra };
}

const stranger = { login: "octocat", type: "User" };
const bot = { login: "renovate[bot]", type: "Bot" };

describe("who is who", () => {
  it("knows a bot by its type or by its login", () => {
    expect(isBot({ type: "Bot" })).toBe(true);
    expect(isBot({ login: "app[bot]", type: "User" })).toBe(true);
    expect(isBot(stranger)).toBe(false);
    expect(isBot(undefined)).toBe(false);
  });

  it("knows the maintainer without regard to case", () => {
    expect(isMaintainer({ login: "dennis-otto" }, ME)).toBe(true);
    expect(isMaintainer(stranger, ME)).toBe(false);
    expect(isMaintainer(undefined, ME)).toBe(false);
  });

  it("requires a check only by its exact name", () => {
    expect(isRequired("lint", ["lint", "check (node)"])).toBe(true);
    expect(isRequired("Lint", ["lint"])).toBe(false);
  });
});

describe("where an event comes from", () => {
  it("drops an event without a repository or installation", () => {
    expect(classify("issues", { action: "opened" }, ME)).toEqual({
      ignored: "no repository or installation",
    });
  });

  it("serves only the repositories of the maintainer", () => {
    const foreign = event({
      repository: { ...repository, owner: { login: "someone" } },
      action: "opened",
      issue: { number: 1, user: stranger },
    });
    expect(classify("issues", foreign, ME)).toEqual({
      ignored: "a repository of another owner",
    });
  });

  it("knows no other event", () => {
    expect(classify("star", event({}), ME)).toEqual({
      ignored: "the event star",
    });
  });
});

describe("contributions from outside", () => {
  const issue = {
    number: 12,
    title: "It breaks <b>",
    html_url: "https://github.com/Dennis-Otto/demo/issues/12",
    user: stranger,
  };

  it("pages for an issue that someone else opened", () => {
    expect(classify("issues", event({ action: "opened", issue }), ME)).toEqual({
      signal: {
        ...at,
        type: "contribution",
        number: 12,
        pull: false,
        title: "It breaks <b>",
        url: issue.html_url,
        author: "octocat",
      },
    });
  });

  it("pages for a pull request that someone else opened", () => {
    const pull = { ...issue, head: { ref: "fix" } };
    const outcome = classify(
      "pull_request",
      event({ action: "opened", pull_request: pull }),
      ME,
    );
    expect(outcome).toMatchObject({
      signal: { type: "contribution", pull: true },
    });
  });

  it("stays quiet for the maintainer and for bots", () => {
    expect(
      classify(
        "issues",
        event({ action: "opened", issue: { ...issue, user: { login: ME } } }),
        ME,
      ),
    ).toEqual({ ignored: "opened by the maintainer" });
    expect(
      classify(
        "pull_request",
        event({ action: "opened", pull_request: { ...issue, user: bot } }),
        ME,
      ),
    ).toEqual({ ignored: "opened by a bot" });
  });

  it("stays quiet for every other change of an issue or pull request", () => {
    expect(classify("issues", event({ action: "edited", issue }), ME)).toEqual({
      ignored: "an issue edited",
    });
    expect(
      classify(
        "pull_request",
        event({ action: "closed", pull_request: issue }),
        ME,
      ),
    ).toEqual({ ignored: "a pull request closed" });
  });

  it("takes an issue without its fields as empty", () => {
    expect(
      classify("issues", event({ action: "opened", issue: {} }), ME),
    ).toEqual({
      signal: {
        ...at,
        type: "contribution",
        number: 0,
        pull: false,
        title: "",
        url: "",
        author: "",
      },
    });
  });
});

describe("discussions from outside", () => {
  const discussion = {
    number: 31,
    title: "How do I <b>?",
    html_url: "https://github.com/Dennis-Otto/demo/discussions/31",
    node_id: "D_kwDOA",
    user: stranger,
    answer_html_url: null,
  };
  const comment = {
    node_id: "DC_kwDOB",
    html_url:
      "https://github.com/Dennis-Otto/demo/discussions/31#discussioncomment-7",
    user: { login: "hubot", type: "User" },
  };

  it("pages for a discussion that someone else opened, to reply on the discussion", () => {
    expect(
      classify("discussion", event({ action: "created", discussion }), ME),
    ).toEqual({
      signal: {
        ...at,
        type: "discussion",
        number: 31,
        title: "How do I <b>?",
        url: discussion.html_url,
        author: "octocat",
        node: "D_kwDOA",
      },
    });
  });

  it("pages for a comment of someone else, to reply in its thread", () => {
    const outcome = classify(
      "discussion_comment",
      event({ action: "created", discussion, comment }),
      ME,
    );
    expect(outcome).toEqual({
      signal: {
        ...at,
        type: "discussion",
        number: 31,
        title: "How do I <b>?",
        url: comment.html_url,
        author: "hubot",
        node: "D_kwDOA",
        comment: "DC_kwDOB",
      },
    });
  });

  it("stays quiet for the maintainer, for bots, and for a discussion with an answer", () => {
    const mine = { ...discussion, user: { login: "dennis-otto" } };
    expect(
      classify(
        "discussion",
        event({ action: "created", discussion: mine }),
        ME,
      ),
    ).toEqual({ ignored: "written by the maintainer" });
    expect(
      classify(
        "discussion_comment",
        event({
          action: "created",
          discussion,
          comment: { ...comment, user: { login: ME } },
        }),
        ME,
      ),
    ).toEqual({ ignored: "written by the maintainer" });
    // Its own reply, which comes back as a comment of the app.
    expect(
      classify(
        "discussion_comment",
        event({
          action: "created",
          discussion,
          comment: { ...comment, user: { login: "dennis-otto-pager[bot]" } },
        }),
        ME,
      ),
    ).toEqual({ ignored: "written by a bot" });
    expect(
      classify(
        "discussion",
        event({ action: "created", discussion: { ...discussion, user: bot } }),
        ME,
      ),
    ).toEqual({ ignored: "written by a bot" });
    expect(
      classify(
        "discussion_comment",
        event({ action: "created", discussion: mine, comment }),
        ME,
      ),
    ).toEqual({ ignored: "a discussion of the maintainer" });
    const answered = {
      ...discussion,
      answer_html_url: `${discussion.html_url}#discussioncomment-5`,
    };
    expect(
      classify(
        "discussion_comment",
        event({ action: "created", discussion: answered, comment }),
        ME,
      ),
    ).toEqual({ ignored: "a discussion with an answer" });
  });

  it("stays quiet for every other change of a discussion or a comment", () => {
    expect(
      classify("discussion", event({ action: "answered", discussion }), ME),
    ).toEqual({ ignored: "a discussion answered" });
    expect(
      classify(
        "discussion_comment",
        event({ action: "edited", discussion, comment }),
        ME,
      ),
    ).toEqual({ ignored: "a discussion comment edited" });
  });

  it("takes a discussion and a comment without their fields as empty", () => {
    const empty = {
      ...at,
      type: "discussion",
      number: 0,
      title: "",
      url: "",
      author: "",
      node: "",
    };
    expect(
      classify("discussion", event({ action: "created", discussion: {} }), ME),
    ).toEqual({ signal: empty });
    expect(
      classify("discussion_comment", event({ action: "created" }), ME),
    ).toEqual({ signal: empty });
  });
});

describe("main failing", () => {
  const run = {
    name: "check (node)",
    conclusion: "failure",
    html_url: "https://github.com/Dennis-Otto/demo/runs/1",
    check_suite: { head_branch: "main" },
  };

  it("passes a finished check run of the default branch on", () => {
    expect(
      classify("check_run", event({ action: "completed", check_run: run }), ME),
    ).toEqual({
      signal: {
        ...at,
        type: "check",
        name: "check (node)",
        failed: true,
        branch: "main",
        url: run.html_url,
      },
    });
    const passed = { ...run, conclusion: "success" };
    expect(
      classify(
        "check_run",
        event({ action: "completed", check_run: passed }),
        ME,
      ),
    ).toMatchObject({ signal: { failed: false } });
  });

  it("drops check runs of other branches, unfinished or cancelled ones", () => {
    const other = { ...run, check_suite: { head_branch: "feat/x" } };
    expect(
      classify(
        "check_run",
        event({ action: "completed", check_run: other }),
        ME,
      ),
    ).toEqual({ ignored: "a check run of another branch" });
    expect(
      classify("check_run", event({ action: "created", check_run: run }), ME),
    ).toEqual({ ignored: "a check run created" });
    const cancelled = { ...run, conclusion: "cancelled" };
    expect(
      classify(
        "check_run",
        event({ action: "completed", check_run: cancelled }),
        ME,
      ),
    ).toEqual({ ignored: "a check run that ended cancelled" });
    expect(classify("check_run", event({ action: "completed" }), ME)).toEqual({
      ignored: "a check run of another branch",
    });
    const unfinished = { check_suite: { head_branch: "main" } };
    expect(
      classify(
        "check_run",
        event({ action: "completed", check_run: unfinished }),
        ME,
      ),
    ).toEqual({ ignored: "a check run that ended " });
    const nameless = { ...unfinished, conclusion: "success" };
    expect(
      classify(
        "check_run",
        event({ action: "completed", check_run: nameless }),
        ME,
      ),
    ).toMatchObject({ signal: { name: "", url: "", failed: false } });
  });

  it("pages for an issue of the bot-health bot and stops with its closing", () => {
    const issue = {
      number: 5,
      title: "Renovate fails",
      html_url: "https://github.com/Dennis-Otto/demo/issues/5",
      user: bot,
      labels: [{ name: "bot-failure" }],
    };
    expect(classify("issues", event({ action: "opened", issue }), ME)).toEqual({
      signal: {
        ...at,
        type: "failing",
        key: "issue:5",
        label: { key: "entry.bot", values: { title: "Renovate fails" } },
        url: issue.html_url,
      },
    });
    expect(
      classify("issues", event({ action: "reopened", issue }), ME),
    ).toMatchObject({ signal: { type: "failing" } });
    expect(classify("issues", event({ action: "closed", issue }), ME)).toEqual({
      signal: { ...at, type: "recovered", key: "issue:5" },
    });
    expect(classify("issues", event({ action: "labeled", issue }), ME)).toEqual(
      {
        ignored: "the labeled of a bot-failure issue",
      },
    );
  });

  it("names the run that the bot-health bot names, and follows it as the bot edits its issue", () => {
    const marker = (state: object) =>
      `<!-- bot-health ${JSON.stringify(state)} -->\nThe workflow **CI** fails.`;
    const issue = {
      number: 5,
      title: "CI fails on main",
      body: marker({ attempt: 1, key: "ci", run: 31, where: "lint" }),
      state: "open",
      html_url: "https://github.com/Dennis-Otto/demo/issues/5",
      user: bot,
      labels: [{ name: "bot-failure" }],
    };
    expect(classify("issues", event({ action: "opened", issue }), ME)).toEqual({
      signal: {
        ...at,
        type: "failing",
        key: "issue:5",
        label: { key: "entry.bot", values: { title: "CI fails on main" } },
        url: issue.html_url,
        run: 31,
      },
    });
    // A failure again, such as of a rerun, edits the open issue: its entry follows,
    // but only an open alarm changes, so an edit never pages.
    const again = { ...issue, body: marker({ attempt: 2, run: 31 }) };
    expect(
      classify("issues", event({ action: "edited", issue: again }), ME),
    ).toEqual({
      signal: {
        ...at,
        type: "still-failing",
        key: "issue:5",
        label: { key: "entry.bot", values: { title: "CI fails on main" } },
        url: issue.html_url,
        run: 31,
      },
    });
    const closed = { ...again, state: "closed" };
    expect(
      classify("issues", event({ action: "edited", issue: closed }), ME),
    ).toEqual({ ignored: "the edited of a bot-failure issue" });
  });

  it("reads a run only from a marker of the bot-health bot that names one", () => {
    expect(healthRun('<!-- bot-health {"run": 7} -->')).toBe(7);
    expect(
      healthRun('text <!-- bot-health {"a": {"b": 1}, "run": 8} -->'),
    ).toBe(8);
    // The bot writes each "--" of its JSON as "-\u002d", which JSON.parse reads as "--".
    expect(
      healthRun('<!-- bot-health {"run": 9, "where": "a-\\u002db"} -->\nText'),
    ).toBe(9);
    for (const body of [
      undefined,
      null,
      "",
      "No marker here.",
      '<!-- bot-health {"key": "renovate", "quiet": 0} -->',
      '<!-- bot-health {"run": "7"} -->',
      '<!-- bot-health {"run": 0} -->',
      '<!-- bot-health {"run": 1.5} -->',
      '<!-- bot-health {"run": 7,} -->',
      '<!-- bot-health {"run": 7}',
      "<!-- bot-health null -->",
      "<!-- bot-health 7 -->",
    ]) {
      expect(healthRun(body)).toBeUndefined();
    }
  });

  it("reads a long body of a bot-health issue at once", () => {
    // What makes a regular expression go back and forth, longer than GitHub lets a
    // body be, takes two searches of the text, well within the time of a test.
    expect(healthRun("<!-- bot-health {{".repeat(50000))).toBeUndefined();
    expect(healthRun(`<!-- bot-health {${" ".repeat(70000)}}`)).toBeUndefined();
  });

  it("names the run of a check of GitHub Actions, and of no other app", () => {
    const actions = {
      ...run,
      html_url: "https://github.com/Dennis-Otto/demo/actions/runs/42/job/7",
    };
    expect(
      classify(
        "check_run",
        event({ action: "completed", check_run: actions }),
        ME,
      ),
    ).toMatchObject({ signal: { type: "check", run: 42 } });
    expect(checkRunOf(run.html_url)).toBeUndefined();
    expect(
      checkRunOf("https://github.com/o/r/actions/runs/99999999999999999/job/1"),
    ).toBeUndefined();
    expect(
      checkRunOf("https://example.com/o/r/actions/runs/42/job/7"),
    ).toBeUndefined();
  });

  it("takes a bot-failure issue without its fields as empty", () => {
    const issue = { user: bot, labels: [{ name: "bot-failure" }, {}] };
    expect(classify("issues", event({ action: "opened", issue }), ME)).toEqual({
      signal: {
        ...at,
        type: "failing",
        key: "issue:0",
        label: { key: "entry.bot", values: { title: "" } },
        url: "",
      },
    });
  });

  it("takes the label bot-failure from a person as a contribution", () => {
    const issue = {
      number: 6,
      user: stranger,
      labels: [{ name: "bot-failure" }],
    };
    expect(
      classify("issues", event({ action: "opened", issue }), ME),
    ).toMatchObject({
      signal: { type: "contribution" },
    });
  });
});

describe("releases", () => {
  const workflow = {
    name: "Release",
    path: ".github/workflows/release.yml",
    event: "push",
    conclusion: "failure",
    html_url: "https://github.com/Dennis-Otto/demo/actions/runs/3",
    head_branch: "main",
  };

  it("pages for a release that fails and stops when it passes", () => {
    expect(
      classify(
        "workflow_run",
        event({ action: "completed", workflow_run: workflow }),
        ME,
      ),
    ).toEqual({
      signal: {
        ...at,
        type: "failing",
        key: "workflow:.github/workflows/release.yml",
        label: { key: "entry.release", values: { name: "Release" } },
        url: workflow.html_url,
      },
    });
    const passed = { ...workflow, conclusion: "success" };
    expect(
      classify(
        "workflow_run",
        event({ action: "completed", workflow_run: passed }),
        ME,
      ),
    ).toEqual({
      signal: {
        ...at,
        type: "recovered",
        key: "workflow:.github/workflows/release.yml",
      },
    });
  });

  it("names the attempt that failed, so that a fix reads its jobs and not those of a rerun", () => {
    const urlOf = (run: object) =>
      (
        classify(
          "workflow_run",
          event({ action: "completed", workflow_run: { ...workflow, ...run } }),
          ME,
        ) as { signal: { url: string } }
      ).signal.url;
    expect(urlOf({ run_attempt: 2 })).toBe(
      "https://github.com/Dennis-Otto/demo/actions/runs/3/attempts/2",
    );
    // The first attempt too: a rerun may start before the fix reads the run.
    expect(urlOf({ run_attempt: 1 })).toBe(
      "https://github.com/Dennis-Otto/demo/actions/runs/3/attempts/1",
    );
    // An attempt that GitHub doesn't name, or a run without an address, stays as it is.
    expect(urlOf({ run_attempt: 0 })).toBe(workflow.html_url);
    expect(urlOf({ run_attempt: "2" })).toBe(workflow.html_url);
    expect(urlOf({ html_url: undefined, run_attempt: 2 })).toBe("");
  });

  it("names the run that failed, for a rerun of its failed jobs", () => {
    const runOf = (id: unknown) =>
      (
        classify(
          "workflow_run",
          event({ action: "completed", workflow_run: { ...workflow, id } }),
          ME,
        ) as { signal: { run?: number } }
      ).signal.run;
    expect(runOf(3)).toBe(3);
    expect(runOf("3")).toBeUndefined();
    expect(runOf(-3)).toBeUndefined();
  });

  it("names a release run without a name by its path", () => {
    const nameless = {
      path: ".github/workflows/verify-release.yml",
      conclusion: "timed_out",
    };
    expect(
      classify(
        "workflow_run",
        event({ action: "completed", workflow_run: nameless }),
        ME,
      ),
    ).toMatchObject({
      signal: {
        label: {
          key: "entry.release",
          values: { name: ".github/workflows/verify-release.yml" },
        },
        url: "",
      },
    });
  });

  it("drops other workflows, pull requests and runs that didn't end", () => {
    const ci = { ...workflow, path: ".github/workflows/ci.yml" };
    expect(
      classify(
        "workflow_run",
        event({ action: "completed", workflow_run: ci }),
        ME,
      ),
    ).toEqual({ ignored: "a workflow run of no release" });
    const pull = { ...workflow, event: "pull_request" };
    expect(
      classify(
        "workflow_run",
        event({ action: "completed", workflow_run: pull }),
        ME,
      ),
    ).toEqual({ ignored: "a workflow run of no release" });
    expect(
      classify(
        "workflow_run",
        event({ action: "requested", workflow_run: workflow }),
        ME,
      ),
    ).toEqual({ ignored: "a workflow run requested" });
    const cancelled = { ...workflow, conclusion: null };
    expect(
      classify(
        "workflow_run",
        event({ action: "completed", workflow_run: cancelled }),
        ME,
      ),
    ).toEqual({ ignored: "a release run that ended " });
    expect(
      classify("workflow_run", event({ action: "completed" }), ME),
    ).toEqual({
      ignored: "a workflow run of no release",
    });
  });

  it("looks at a release pull request when its checks finish", () => {
    const suite = {
      head_branch: "release-please--branches--main",
      pull_requests: [{ number: 30 }, {}],
    };
    expect(
      classify(
        "check_suite",
        event({ action: "completed", check_suite: suite }),
        ME,
      ),
    ).toEqual({ signal: { ...at, type: "release-check", numbers: [30] } });
    expect(
      classify(
        "check_suite",
        event({ action: "requested", check_suite: suite }),
        ME,
      ),
    ).toEqual({ ignored: "a check suite requested" });
    expect(
      classify(
        "check_suite",
        event({ action: "completed", check_suite: { head_branch: "feat/x" } }),
        ME,
      ),
    ).toEqual({ ignored: "a check suite of no release" });
    expect(
      classify(
        "check_suite",
        event({
          action: "completed",
          check_suite: { head_branch: suite.head_branch },
        }),
        ME,
      ),
    ).toEqual({ ignored: "a check suite of no pull request" });
    expect(classify("check_suite", event({ action: "completed" }), ME)).toEqual(
      {
        ignored: "a check suite of no release",
      },
    );
  });

  it("follows a release pull request: updated, merged, published", () => {
    const pull = {
      number: 30,
      merged: true,
      head: { ref: "release-please--branches--main", sha: "abc" },
    };
    expect(
      classify(
        "pull_request",
        event({ action: "synchronize", pull_request: pull }),
        ME,
      ),
    ).toEqual({
      signal: { ...at, type: "release-updated", number: 30, sha: "abc" },
    });
    expect(
      classify(
        "pull_request",
        event({ action: "closed", pull_request: pull }),
        ME,
      ),
    ).toEqual({ signal: { ...at, type: "release-merged", number: 30 } });
    expect(
      classify(
        "pull_request",
        event({ action: "closed", pull_request: { ...pull, merged: false } }),
        ME,
      ),
    ).toEqual({ ignored: "a release pull request closed" });
    expect(
      classify(
        "pull_request",
        event({
          action: "synchronize",
          pull_request: { head: { ref: "release-please--x" } },
        }),
        ME,
      ),
    ).toEqual({
      signal: { ...at, type: "release-updated", number: 0, sha: "" },
    });
    expect(
      classify(
        "release",
        event({ action: "published", release: { tag_name: "v1.2.3" } }),
        ME,
      ),
    ).toEqual({ signal: { ...at, type: "release-published", tag: "v1.2.3" } });
    expect(classify("release", event({ action: "published" }), ME)).toEqual({
      signal: { ...at, type: "release-published", tag: "" },
    });
    expect(
      classify(
        "release",
        event({
          action: "published",
          release: { tag_name: "v2.0.0-beta.1", prerelease: true },
        }),
        ME,
      ),
    ).toEqual({ ignored: "a release published" });
    expect(classify("release", event({ action: "created" }), ME)).toEqual({
      ignored: "a release created",
    });
  });

  it("reads the version from the title of release-please", () => {
    expect(releaseVersion("chore: release 1.2.3")).toBe("1.2.3");
    expect(releaseVersion("chore(main): release 2.0.0-beta.1")).toBe(
      "2.0.0-beta.1",
    );
    expect(releaseVersion("feat: release notes")).toBeNull();
  });

  it("merges only an open, clean release pull request into the default branch", () => {
    const ready = {
      state: "open",
      title: "chore: release 1.2.3",
      mergeable_state: "clean",
      draft: false,
      head: { ref: "release-please--branches--main" },
      base: { ref: "main" },
    };
    expect(why(ready, "main")).toBeNull();
    expect(why({ ...ready, state: "closed" }, "main")).toBe("it isn't open");
    expect(why({ ...ready, head: { ref: "feat/x" } }, "main")).toBe(
      "it isn't a release pull request",
    );
    expect(why({ ...ready, head: {} }, "main")).toBe(
      "it isn't a release pull request",
    );
    expect(why({ ...ready, base: { ref: "next" } }, "main")).toBe(
      "it doesn't go into main",
    );
    expect(why({ ...ready, title: "chore: tidy" }, "main")).toBe(
      "its title names no release",
    );
    const { title: _title, ...untitled } = ready;
    expect(why(untitled, "main")).toBe("its title names no release");
    expect(why({ ...ready, draft: true }, "main")).toBe("it is a draft");
    expect(why({ ...ready, mergeable_state: "blocked" }, "main")).toBe(
      "its checks aren't all green (blocked)",
    );
    const { mergeable_state: _state, ...unknown } = ready;
    expect(why(unknown, "main")).toBe("its checks aren't all green (unknown)");
  });
});

describe("code scanning", () => {
  const alert = {
    number: 4,
    html_url: "https://github.com/Dennis-Otto/demo/security/code-scanning/4",
    rule: {
      id: "js/xss",
      description: "Cross-site scripting",
      security_severity_level: "high",
    },
    most_recent_instance: { location: { path: "src/index.ts" } },
  };
  const ref = "refs/heads/main";

  it("pages for a new alert of severity high or critical on the default branch", () => {
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "created", alert, ref }),
        ME,
      ),
    ).toEqual({
      signal: {
        ...at,
        type: "alert-open",
        key: "alert:4",
        label: {
          key: "entry.alertAt",
          values: {
            severity: "high",
            what: "Cross-site scripting",
            path: "src/index.ts",
          },
        },
        url: alert.html_url,
      },
    });
  });

  it("names an alert by its rule where it has no description or place", () => {
    const bare = {
      number: 5,
      rule: { id: "js/sqli", security_severity_level: "critical" },
    };
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "reopened", alert: bare, ref }),
        ME,
      ),
    ).toMatchObject({
      signal: {
        label: {
          key: "entry.alert",
          values: { severity: "critical", what: "js/sqli" },
        },
        url: "",
      },
    });
    const empty = { rule: { security_severity_level: "critical" } };
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "created", alert: empty, ref }),
        ME,
      ),
    ).toMatchObject({
      signal: {
        key: "alert:0",
        label: {
          key: "entry.alert",
          values: { severity: "critical", what: "" },
        },
      },
    });
  });

  it("closes an alert that was fixed or dismissed", () => {
    for (const action of ["fixed", "auto_dismissed"]) {
      expect(
        classify("code_scanning_alert", event({ action, alert, ref }), ME),
      ).toEqual({ signal: { ...at, type: "alert-closed", key: "alert:4" } });
    }
    // A person's dismissal comes with an empty ref, as GitHub sends it.
    const elsewhere = {
      ...alert,
      most_recent_instance: { ref: "refs/heads/topic" },
    };
    for (const dismissed of [alert, elsewhere]) {
      expect(
        classify(
          "code_scanning_alert",
          event({ action: "closed_by_user", alert: dismissed, ref: "" }),
          ME,
        ),
      ).toEqual({ signal: { ...at, type: "alert-closed", key: "alert:4" } });
    }
  });

  it("pages for an alert that a person reopened, with the empty ref of GitHub", () => {
    const onMain = {
      ...alert,
      most_recent_instance: { ...alert.most_recent_instance, ref },
    };
    for (const reopened of [alert, onMain]) {
      expect(
        classify(
          "code_scanning_alert",
          event({ action: "reopened_by_user", alert: reopened, ref: "" }),
          ME,
        ),
      ).toMatchObject({ signal: { type: "alert-open", key: "alert:4" } });
    }
    const elsewhere = {
      ...alert,
      most_recent_instance: { ref: "refs/heads/topic" },
    };
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "reopened_by_user", alert: elsewhere, ref: "" }),
        ME,
      ),
    ).toEqual({ ignored: "an alert of another branch" });
  });

  it("drops milder alerts, other branches and other actions", () => {
    const medium = {
      ...alert,
      rule: { ...alert.rule, security_severity_level: "medium" },
    };
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "created", alert: medium, ref }),
        ME,
      ),
    ).toEqual({ ignored: "an alert of severity medium" });
    const none = { ...alert, rule: {} };
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "created", alert: none, ref }),
        ME,
      ),
    ).toEqual({ ignored: "an alert of severity none" });
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "created", alert, ref: "refs/pull/3/merge" }),
        ME,
      ),
    ).toEqual({ ignored: "an alert of another branch" });
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "appeared_in_branch", alert, ref }),
        ME,
      ),
    ).toEqual({ ignored: "an alert appeared_in_branch" });
    expect(
      classify(
        "code_scanning_alert",
        {
          installation: { id: 1 },
          repository: { full_name: "Dennis-Otto/x", owner: { login: ME } },
        },
        ME,
      ),
    ).toEqual({ ignored: "an alert of another branch" });
    expect(classify("code_scanning_alert", event({ alert, ref }), ME)).toEqual({
      ignored: "an alert ",
    });
  });
});

describe("any payload", () => {
  it("is classified without an error", () => {
    const events = fc.constantFrom(
      "issues",
      "pull_request",
      "discussion",
      "discussion_comment",
      "check_run",
      "check_suite",
      "workflow_run",
      "code_scanning_alert",
      "release",
      "push",
    );
    fc.assert(
      fc.property(events, fc.object(), (name, extra) => {
        const outcome = classify(name, event(extra as Payload), ME);
        return "signal" in outcome || typeof outcome.ignored === "string";
      }),
    );
  });
});
