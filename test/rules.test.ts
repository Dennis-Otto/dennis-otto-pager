// The rules of what counts, event by event: each kind of event that pages the
// maintainer, and each reason why one doesn't.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  classify,
  isBot,
  isMaintainer,
  isRequired,
  type Payload,
  releaseBlocker,
  releaseVersion,
} from "../src/rules.ts";

const ME = "Dennis-Otto";
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
        label: "A bot fails: Renovate fails",
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

  it("takes a bot-failure issue without its fields as empty", () => {
    const issue = { user: bot, labels: [{ name: "bot-failure" }, {}] };
    expect(classify("issues", event({ action: "opened", issue }), ME)).toEqual({
      signal: {
        ...at,
        type: "failing",
        key: "issue:0",
        label: "A bot fails: ",
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
        label: "The release fails: Release",
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
        label: "The release fails: .github/workflows/verify-release.yml",
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
    expect(releaseBlocker(ready, "main")).toBeNull();
    expect(releaseBlocker({ ...ready, state: "closed" }, "main")).toBe(
      "it isn't open",
    );
    expect(releaseBlocker({ ...ready, head: { ref: "feat/x" } }, "main")).toBe(
      "it isn't a release pull request",
    );
    expect(releaseBlocker({ ...ready, head: {} }, "main")).toBe(
      "it isn't a release pull request",
    );
    expect(releaseBlocker({ ...ready, base: { ref: "next" } }, "main")).toBe(
      "it doesn't go into main",
    );
    expect(releaseBlocker({ ...ready, title: "chore: tidy" }, "main")).toBe(
      "its title names no release",
    );
    const { title: _title, ...untitled } = ready;
    expect(releaseBlocker(untitled, "main")).toBe("its title names no release");
    expect(releaseBlocker({ ...ready, draft: true }, "main")).toBe(
      "it is a draft",
    );
    expect(
      releaseBlocker({ ...ready, mergeable_state: "blocked" }, "main"),
    ).toBe("its checks aren't all green (blocked)");
    const { mergeable_state: _state, ...unknown } = ready;
    expect(releaseBlocker(unknown, "main")).toBe(
      "its checks aren't all green (unknown)",
    );
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
        label: "high: Cross-site scripting in src/index.ts",
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
    ).toMatchObject({ signal: { label: "critical: js/sqli", url: "" } });
    const empty = { rule: { security_severity_level: "critical" } };
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "created", alert: empty, ref }),
        ME,
      ),
    ).toMatchObject({ signal: { key: "alert:0", label: "critical: " } });
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
