// The rules of what counts, event by event: each kind of event that pages the
// maintainer, and each reason why one doesn't.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MAX_EXCERPT } from "../src/content.ts";
import {
  asksForUpload,
  checkRunOf,
  classify,
  finishedRun,
  healthRun,
  isBot,
  isMaintainer,
  isRequired,
  isServed,
  type Payload,
  picturesBlocker,
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

  it("serves the repositories of the further owners of OWNERS as well", () => {
    const ORG = "octo-org";
    const ofTheOrganization = event({
      repository: {
        ...repository,
        full_name: `${ORG}/demo`,
        owner: { login: "Octo-Org", type: "Organization" },
      },
      action: "opened",
      issue: { number: 1, user: stranger },
    });
    expect(classify("issues", ofTheOrganization, ME, [ORG])).toMatchObject({
      signal: { repo: `${ORG}/demo`, type: "contribution", author: "octocat" },
    });
    // Without OWNERS, the organization is another owner, and so is any owner
    // that OWNERS doesn't name.
    expect(classify("issues", ofTheOrganization, ME)).toEqual({
      ignored: "a repository of another owner",
    });
    expect(classify("issues", ofTheOrganization, ME, ["other-org"])).toEqual({
      ignored: "a repository of another owner",
    });
    // The maintainer's own repositories stay served beside them.
    expect(
      classify(
        "issues",
        event({ action: "opened", issue: { number: 1, user: stranger } }),
        ME,
        [ORG],
      ),
    ).toMatchObject({ signal: { type: "contribution" } });
  });

  it("keeps the maintainer alone the maintainer in a repository of an organization", () => {
    const repo = {
      ...repository,
      full_name: "octo-org/demo",
      owner: { login: "octo-org", type: "Organization" },
    };
    const opened = (user: { login: string }) =>
      event({
        repository: repo,
        action: "opened",
        issue: { number: 1, user },
      });
    expect(classify("issues", opened({ login: ME }), ME, ["octo-org"])).toEqual(
      { ignored: "opened by the maintainer" },
    );
    // The organization serves, but is nobody's own: what it opens, as anyone
    // else, is a contribution.
    expect(
      classify("issues", opened({ login: "octo-org" }), ME, ["octo-org"]),
    ).toMatchObject({ signal: { type: "contribution", author: "octo-org" } });
  });

  it("knows whom it serves without regard to case", () => {
    expect(isServed({ login: "dennis-otto" }, ME, [])).toBe(true);
    expect(isServed({ login: "OCTO-ORG" }, ME, ["octo-org"])).toBe(true);
    expect(isServed(stranger, ME, ["octo-org"])).toBe(false);
    expect(isServed(undefined, ME, ["octo-org"])).toBe(false);
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
        event({ action: "edited", pull_request: issue }),
        ME,
      ),
    ).toEqual({ ignored: "a pull request edited" });
  });

  it("passes on the start of what an issue or a pull request says, without the hints of its form", () => {
    const body =
      "<!-- Describe the bug. -->\r\nIt breaks <b>here</b>.\r\n\r\n\r\n\r\nSee the log.";
    expect(
      classify(
        "issues",
        event({ action: "opened", issue: { ...issue, body } }),
        ME,
      ),
    ).toMatchObject({
      signal: {
        type: "contribution",
        excerpt: "It breaks <b>here</b>.\n\nSee the log.",
      },
    });
    expect(
      classify(
        "pull_request",
        event({
          action: "opened",
          pull_request: { ...issue, body: "x".repeat(MAX_EXCERPT + 1) },
        }),
        ME,
      ),
    ).toMatchObject({
      signal: {
        type: "contribution",
        excerpt: `${"x".repeat(MAX_EXCERPT - 1)}…`,
      },
    });
    // A body that says nothing, or none, passes nothing on.
    for (const empty of [null, "", "<!-- only hints -->"]) {
      const outcome = classify(
        "issues",
        event({ action: "opened", issue: { ...issue, body: empty } }),
        ME,
      );
      expect(outcome).toMatchObject({ signal: { type: "contribution" } });
      expect(outcome).not.toHaveProperty("signal.excerpt");
    }
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

describe("comments on issues and pull requests from outside", () => {
  const issue = {
    number: 12,
    title: "It breaks <b>",
    html_url: "https://github.com/Dennis-Otto/demo/issues/12",
    user: stranger,
    state: "open",
  };
  const comment = {
    id: 99,
    node_id: "IC_kwDOC",
    html_url: "https://github.com/Dennis-Otto/demo/issues/12#issuecomment-99",
    user: { login: "hubot", type: "User" },
  };
  const commented = (extra: Payload = {}) =>
    classify(
      "issue_comment",
      event({ action: "created", issue, comment, ...extra }),
      ME,
    );
  const done = (reason: string, number = 12) => ({
    signal: { ...at, type: "contribution-done", number, reason },
  });

  it("pages for a comment of someone else on an issue of someone else, which the reply answers", () => {
    expect(commented()).toEqual({
      signal: {
        ...at,
        type: "comment",
        number: 12,
        pull: false,
        title: "It breaks <b>",
        url: comment.html_url,
        author: "hubot",
        comment: 99,
      },
    });
  });

  it("passes on the start of the comment, not of its issue", () => {
    expect(
      commented({
        issue: { ...issue, body: "The issue" },
        comment: { ...comment, body: "The comment" },
      }),
    ).toMatchObject({ signal: { type: "comment", excerpt: "The comment" } });
    expect(
      commented({ issue: { ...issue, body: "The issue" } }),
    ).not.toHaveProperty("signal.excerpt");
  });

  it("knows a comment on a pull request by the pull request of its issue", () => {
    expect(
      commented({ issue: { ...issue, pull_request: { url: "x" } } }),
    ).toMatchObject({ signal: { type: "comment", number: 12, pull: true } });
  });

  it("pages for a comment on a closed issue as well, since it may need an answer", () => {
    expect(commented({ issue: { ...issue, state: "closed" } })).toMatchObject({
      signal: { type: "comment", comment: 99 },
    });
  });

  it("ends the wait for a reply when the maintainer answered on GitHub itself", () => {
    expect(
      commented({ comment: { ...comment, user: { login: "dennis-otto" } } }),
    ).toEqual(done("replied"));
  });

  it("stays quiet for a bot, and for an issue or a pull request of the maintainer or of a bot", () => {
    // Such as the issue assistant, or the bot that reports a failure.
    expect(
      commented({
        comment: { ...comment, user: { login: "issue-assistant[bot]" } },
      }),
    ).toEqual({ ignored: "written by a bot" });
    for (const user of [{ login: ME }, bot]) {
      for (const author of [comment.user, { login: ME }]) {
        expect(
          commented({
            issue: { ...issue, user },
            comment: { ...comment, user: author },
          }),
        ).toEqual({
          ignored: "a comment on an issue of the maintainer or of a bot",
        });
      }
    }
  });

  it("stays quiet for a comment that was edited or deleted", () => {
    for (const action of ["edited", "deleted"]) {
      expect(
        classify("issue_comment", event({ action, issue, comment }), ME),
      ).toEqual({ ignored: `an issue comment ${action}` });
    }
  });

  it("drops a comment without its id, which the pager needs to know it again", () => {
    const { id: _id, ...nameless } = comment;
    for (const without of [
      nameless,
      { ...comment, id: 0 },
      { ...comment, id: -3 },
      { ...comment, id: 1.5 },
    ]) {
      expect(commented({ comment: without })).toEqual({
        ignored: "a comment without its id",
      });
    }
  });

  it("takes an issue and a comment without their other fields as empty", () => {
    expect(
      classify(
        "issue_comment",
        event({ action: "created", comment: { id: 5 } }),
        ME,
      ),
    ).toEqual({
      signal: {
        ...at,
        type: "comment",
        number: 0,
        pull: false,
        title: "",
        url: "",
        author: "",
        comment: 5,
      },
    });
  });

  it("ends the wait for a reply once an issue or a pull request of someone else closed", () => {
    expect(classify("issues", event({ action: "closed", issue }), ME)).toEqual(
      done("closed"),
    );
    const pull = { ...issue, head: { ref: "fix" } };
    expect(
      classify(
        "pull_request",
        event({ action: "closed", pull_request: pull }),
        ME,
      ),
    ).toEqual(done("closed"));
    expect(
      classify(
        "pull_request",
        event({ action: "closed", pull_request: { ...pull, merged: true } }),
        ME,
      ),
    ).toEqual(done("merged"));
    expect(
      classify("issues", event({ action: "closed", issue: {} }), ME),
    ).toEqual(done("closed", 0));
  });

  it("knows no end of an issue of the maintainer or of a bot, which made no thing", () => {
    for (const user of [{ login: ME }, bot]) {
      expect(
        classify(
          "issues",
          event({ action: "closed", issue: { ...issue, user } }),
          ME,
        ),
      ).toEqual({ ignored: "an issue of the maintainer or of a bot closed" });
    }
  });
});

describe("reviews of pull requests from outside", () => {
  const pull = {
    number: 14,
    title: "Fix it",
    html_url: "https://github.com/Dennis-Otto/demo/pull/14",
    user: stranger,
    head: { ref: "fix" },
  };
  const hubot = { login: "hubot", type: "User" };
  const found = {
    id: 7,
    html_url: "https://github.com/Dennis-Otto/demo/pull/14#pullrequestreview-7",
    body: "Looks good, one question.",
    user: hubot,
    state: "commented",
  };
  const comment = {
    id: 5,
    html_url: "https://github.com/Dennis-Otto/demo/pull/14#discussion_r5",
    body: "Done, renamed it.",
    user: hubot,
  };
  const reviewed = (extra: Payload = {}, action = "submitted") =>
    classify(
      "pull_request_review",
      event({ action, pull_request: pull, review: found, ...extra }),
      ME,
    );
  const commented = (extra: Payload = {}, action = "created") =>
    classify(
      "pull_request_review_comment",
      event({ action, pull_request: pull, comment, ...extra }),
      ME,
    );

  it("pages for a review of someone else, with its text", () => {
    expect(reviewed()).toEqual({
      signal: {
        ...at,
        type: "comment",
        number: 14,
        pull: true,
        title: "Fix it",
        url: found.html_url,
        author: "hubot",
        comment: 7,
        kind: "review",
        excerpt: "Looks good, one question.",
      },
    });
  });

  it("pages for a reply in the thread of a review, the usual answer to one", () => {
    expect(commented()).toEqual({
      signal: {
        ...at,
        type: "comment",
        number: 14,
        pull: true,
        title: "Fix it",
        url: comment.html_url,
        author: "hubot",
        comment: 5,
        kind: "reviewComment",
        excerpt: "Done, renamed it.",
      },
    });
  });

  it("takes an approval or a request for changes without words as news", () => {
    for (const state of ["approved", "changes_requested", "APPROVED"]) {
      const outcome = reviewed({ review: { ...found, state, body: null } });
      expect(outcome).toMatchObject({
        signal: { type: "comment", kind: "review", comment: 7 },
      });
      expect(outcome).not.toHaveProperty("signal.excerpt");
    }
  });

  it("leaves a review that says nothing but its comments to those comments", () => {
    // GitHub makes such a review for each reply in the thread of a review comment.
    for (const body of [null, "", "<!-- nothing -->"]) {
      for (const state of ["commented", "COMMENTED"]) {
        expect(reviewed({ review: { ...found, state, body } })).toEqual({
          ignored: "a review that says nothing but its comments",
        });
      }
    }
  });

  it("ends the wait for a reply when the maintainer reviewed or answered in the code", () => {
    const done = {
      signal: {
        ...at,
        type: "contribution-done",
        number: 14,
        reason: "replied",
      },
    };
    const me = { login: "dennis-otto" };
    expect(
      reviewed({ review: { ...found, user: me, state: "changes_requested" } }),
    ).toEqual(done);
    // Also his reply in a thread, which comes with a review without words.
    expect(reviewed({ review: { ...found, user: me, body: "" } })).toEqual(
      done,
    );
    expect(commented({ comment: { ...comment, user: me } })).toEqual(done);
  });

  it("stays quiet for a bot, and for a pull request of the maintainer or of a bot", () => {
    expect(reviewed({ review: { ...found, user: bot } })).toEqual({
      ignored: "written by a bot",
    });
    expect(commented({ comment: { ...comment, user: bot } })).toEqual({
      ignored: "written by a bot",
    });
    for (const user of [{ login: ME }, bot]) {
      expect(reviewed({ pull_request: { ...pull, user } })).toEqual({
        ignored: "a review of a pull request of the maintainer or of a bot",
      });
      expect(commented({ pull_request: { ...pull, user } })).toEqual({
        ignored:
          "a review comment on a pull request of the maintainer or of a bot",
      });
    }
  });

  it("stays quiet for a review edited or dismissed, and a review comment edited or deleted", () => {
    for (const action of ["edited", "dismissed"]) {
      expect(reviewed({}, action)).toEqual({ ignored: `a review ${action}` });
    }
    for (const action of ["edited", "deleted"]) {
      expect(commented({}, action)).toEqual({
        ignored: `a review comment ${action}`,
      });
    }
  });

  it("drops a review or a review comment without its id", () => {
    const { id: _review, ...nameless } = found;
    expect(reviewed({ review: nameless })).toEqual({
      ignored: "a comment without its id",
    });
    const { id: _comment, ...anonymous } = comment;
    expect(commented({ comment: anonymous })).toEqual({
      ignored: "a comment without its id",
    });
  });

  it("takes a pull request and a review without their other fields as empty", () => {
    expect(
      classify(
        "pull_request_review",
        event({ action: "submitted", review: { id: 3 } }),
        ME,
      ),
    ).toEqual({
      signal: {
        ...at,
        type: "comment",
        number: 0,
        pull: true,
        title: "",
        url: "",
        author: "",
        comment: 3,
        kind: "review",
      },
    });
  });
});

describe("what someone else does to a pull request or an issue after it", () => {
  const UPDATED = "2026-11-12T08:00:00Z";
  const pull = {
    number: 14,
    title: "Fix it",
    body: "It fixes the crash.",
    html_url: "https://github.com/Dennis-Otto/demo/pull/14",
    user: stranger,
    head: { ref: "fix" },
    updated_at: UPDATED,
  };
  const issue = {
    number: 12,
    title: "It breaks",
    html_url: "https://github.com/Dennis-Otto/demo/issues/12",
    user: stranger,
    updated_at: UPDATED,
  };
  const pushed = (action: string, extra: Payload = {}) =>
    classify(
      "pull_request",
      event({ action, pull_request: pull, sender: stranger, ...extra }),
      ME,
    );

  it("pages for new commits, a reopen and ready for review of a pull request", () => {
    const what = {
      synchronize: "commits",
      reopened: "reopened",
      ready_for_review: "ready",
    };
    for (const [action, done] of Object.entries(what)) {
      expect(pushed(action)).toEqual({
        signal: {
          ...at,
          type: "activity",
          number: 14,
          pull: true,
          title: "Fix it",
          url: pull.html_url,
          author: "octocat",
          by: "octocat",
          what: done,
          changed: UPDATED,
          excerpt: "It fixes the crash.",
        },
      });
    }
  });

  it("names who did it, such as a co-author, beside who opened it", () => {
    expect(pushed("synchronize", { sender: { login: "hubot" } })).toMatchObject(
      { signal: { author: "octocat", by: "hubot" } },
    );
  });

  it("pages for an issue that someone else reopened", () => {
    expect(
      classify(
        "issues",
        event({ action: "reopened", issue, sender: stranger }),
        ME,
      ),
    ).toEqual({
      signal: {
        ...at,
        type: "activity",
        number: 12,
        pull: false,
        title: "It breaks",
        url: issue.html_url,
        author: "octocat",
        by: "octocat",
        what: "reopened",
        changed: UPDATED,
      },
    });
  });

  it("stays quiet for what the maintainer or a bot does, such as a branch brought up to date", () => {
    for (const sender of [{ login: "dennis-otto" }, bot]) {
      expect(pushed("synchronize", { sender })).toEqual({
        ignored: "a pull request synchronize by the maintainer or a bot",
      });
      expect(
        classify("issues", event({ action: "reopened", issue, sender }), ME),
      ).toEqual({ ignored: "an issue reopened by the maintainer or a bot" });
    }
  });

  it("stays quiet for a pull request or an issue of the maintainer or of a bot", () => {
    for (const user of [{ login: ME }, bot]) {
      expect(
        pushed("synchronize", { pull_request: { ...pull, user } }),
      ).toEqual({
        ignored: "a pull request of the maintainer or of a bot synchronize",
      });
      expect(
        classify(
          "issues",
          event({
            action: "reopened",
            issue: { ...issue, user },
            sender: stranger,
          }),
          ME,
        ),
      ).toEqual({ ignored: "an issue of the maintainer or of a bot reopened" });
    }
  });

  it("takes a pull request without its fields as empty, and without the time of its change", () => {
    expect(
      classify("pull_request", event({ action: "synchronize" }), ME),
    ).toEqual({
      signal: {
        ...at,
        type: "activity",
        number: 0,
        pull: true,
        title: "",
        url: "",
        author: "",
        by: "",
        what: "commits",
      },
    });
  });

  it("keeps the new commits of a release pull request for the release", () => {
    expect(
      pushed("synchronize", {
        pull_request: {
          ...pull,
          head: {
            ref: "release-please--branches--main",
            sha: "abc",
            repo: { full_name: "Dennis-Otto/demo" },
          },
        },
      }),
    ).toMatchObject({ signal: { type: "release-updated" } });
  });

  it("pages for new commits on a branch of a fork named like release-please", () => {
    expect(
      pushed("synchronize", {
        pull_request: {
          ...pull,
          head: {
            ref: "release-please--branches--main",
            sha: "abc",
            repo: { full_name: "octocat/demo" },
          },
        },
      }),
    ).toMatchObject({ signal: { type: "activity", what: "commits" } });
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

  it("passes on the start of the discussion, or of the comment that the reply answers", () => {
    const said = { ...discussion, body: "How do I start?" };
    expect(
      classify(
        "discussion",
        event({ action: "created", discussion: said }),
        ME,
      ),
    ).toMatchObject({ signal: { excerpt: "How do I start?" } });
    expect(
      classify(
        "discussion_comment",
        event({
          action: "created",
          discussion: said,
          comment: { ...comment, body: "Read the README" },
        }),
        ME,
      ),
    ).toMatchObject({
      signal: { comment: "DC_kwDOB", excerpt: "Read the README" },
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
    // Its own reply, which comes back as a comment of the app.
    expect(
      classify(
        "discussion_comment",
        event({
          action: "created",
          discussion,
          comment: { ...comment, user: { login: "repo-pager[bot]" } },
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

  it("ends the wait for a reply once GitHub dealt with a discussion", () => {
    const done = (reason: string) => ({
      signal: { ...at, type: "discussion-done", number: 31, reason },
    });
    // The maintainer replied on GitHub itself, to the discussion or in a thread.
    expect(
      classify(
        "discussion_comment",
        event({
          action: "created",
          discussion,
          comment: { ...comment, user: { login: "dennis-otto" } },
        }),
        ME,
      ),
    ).toEqual(done("replied"));
    for (const action of ["answered", "closed", "deleted"]) {
      expect(classify("discussion", event({ action, discussion }), ME)).toEqual(
        done(action),
      );
      // A discussion of the maintainer made no thing, so its end means nothing.
      expect(
        classify(
          "discussion",
          event({ action, discussion: { ...discussion, user: { login: ME } } }),
          ME,
        ),
      ).toEqual({ ignored: "a discussion of the maintainer" });
    }
    expect(
      classify(
        "discussion_comment",
        event({
          action: "created",
          discussion: { ...discussion, user: { login: ME } },
          comment: { ...comment, user: { login: ME } },
        }),
        ME,
      ),
    ).toEqual({ ignored: "a discussion of the maintainer" });
    // A comment that was deleted is no end of its discussion.
    expect(
      classify(
        "discussion_comment",
        event({ action: "deleted", discussion, comment }),
        ME,
      ),
    ).toEqual({ ignored: "a discussion comment deleted" });
    expect(
      classify("discussion", event({ action: "answered", discussion: {} }), ME),
    ).toEqual({
      signal: { ...at, type: "discussion-done", number: 0, reason: "answered" },
    });
  });

  it("stays quiet for every other change of a discussion or a comment", () => {
    expect(
      classify("discussion", event({ action: "unanswered", discussion }), ME),
    ).toEqual({ ignored: "a discussion unanswered" });
    expect(classify("discussion", event({ discussion }), ME)).toEqual({
      ignored: "a discussion undefined",
    });
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

  it("passes an issue of the bot-health bot on and stops with its closing", () => {
    const issue = {
      number: 5,
      title: "Renovate fails",
      html_url: "https://github.com/Dennis-Otto/demo/issues/5",
      user: bot,
      labels: [{ name: "bot-failure" }],
    };
    // Without a run that the pager could read, it is the entry of the alarm that
    // it was before the pager paged workflows.
    expect(classify("issues", event({ action: "opened", issue }), ME)).toEqual({
      signal: {
        ...at,
        type: "health",
        branch: "main",
        fallback: {
          type: "failing",
          key: "issue:5",
          label: { key: "entry.bot", values: { title: "Renovate fails" } },
          url: issue.html_url,
        },
      },
    });
    expect(
      classify("issues", event({ action: "reopened", issue }), ME),
    ).toMatchObject({
      signal: { type: "health", fallback: { type: "failing" } },
    });
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
    const failure = {
      key: "issue:5",
      label: { key: "entry.bot", values: { title: "CI fails on main" } },
      url: issue.html_url,
      run: 31,
    };
    expect(classify("issues", event({ action: "opened", issue }), ME)).toEqual({
      signal: {
        ...at,
        type: "health",
        run: 31,
        branch: "main",
        fallback: { type: "failing", ...failure },
      },
    });
    // A failure again, such as of a rerun, edits the open issue: the pager reads
    // its run again, and its entry, where it has one, follows, but only an open
    // alarm changes, so an edit never pages as an entry.
    const again = { ...issue, body: marker({ attempt: 2, run: 31 }) };
    expect(
      classify("issues", event({ action: "edited", issue: again }), ME),
    ).toEqual({
      signal: {
        ...at,
        type: "health",
        run: 31,
        branch: "main",
        fallback: { type: "still-failing", ...failure },
      },
    });
    const closed = { ...again, state: "closed" };
    expect(
      classify("issues", event({ action: "edited", issue: closed }), ME),
    ).toEqual({ ignored: "the edited of a bot-failure issue" });
  });

  it("words the issue that asks for an upload of the social preview as what to do, not as a bot that fails", () => {
    // The bot keeps this issue open while GitHub shows another picture than the
    // committed one, which only a person can upload: it names no run, and nothing fails.
    const issue = {
      number: 123,
      title: "Upload the new social preview",
      body: '<!-- bot-health {"key": "social-preview", "sha256": "ab-\\u002dcd"} -->\nGitHub shows a card of its own.',
      state: "open",
      html_url: "https://github.com/Dennis-Otto/demo/issues/123",
      user: bot,
      labels: [{ name: "bot-failure" }],
    };
    // Its entry keeps the key of the issue, whose closing takes it out, and is
    // marked as an upload, which no 🛠 Start fix can make.
    const upload = {
      key: "issue:123",
      label: { key: "entry.preview" },
      url: issue.html_url,
      upload: true,
    };
    expect(classify("issues", event({ action: "opened", issue }), ME)).toEqual({
      signal: {
        ...at,
        type: "health",
        branch: "main",
        fallback: { type: "failing", ...upload },
      },
    });
    // A new picture edits the issue, and the bot closes it once GitHub shows it.
    expect(
      classify("issues", event({ action: "edited", issue }), ME),
    ).toMatchObject({
      signal: { fallback: { type: "still-failing", ...upload } },
    });
    expect(classify("issues", event({ action: "closed", issue }), ME)).toEqual({
      signal: { ...at, type: "recovered", key: "issue:123" },
    });
    // The marker decides, not the title: another key is a bot that fails.
    const renovate = {
      ...issue,
      title: "Renovate logs problems",
      body: '<!-- bot-health {"key": "renovate", "quiet": 0} -->',
    };
    expect(
      classify("issues", event({ action: "opened", issue: renovate }), ME),
    ).toMatchObject({
      signal: {
        fallback: {
          label: {
            key: "entry.bot",
            values: { title: "Renovate logs problems" },
          },
        },
      },
    });
  });

  it("knows the issue of the social preview only by the key in a marker of the bot-health bot", () => {
    expect(asksForUpload('<!-- bot-health {"key": "social-preview"} -->')).toBe(
      true,
    );
    for (const body of [
      undefined,
      null,
      "",
      "social-preview",
      '<!-- bot-health {"key": "renovate"} -->',
      '<!-- bot-health {"key": ".github/workflows/ci.yml", "run": 7} -->',
      '<!-- bot-health {"key": ["social-preview"]} -->',
      '<!-- bot-health {"key": "social-preview"}',
      "<!-- bot-health null -->",
      '<!-- bot-health "social-preview" -->',
    ]) {
      expect(asksForUpload(body), String(body)).toBe(false);
    }
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

  it("leaves a job of GitHub Actions to its workflow run, and takes out the entry of its pass", () => {
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
    ).toEqual({ ignored: "a job of a workflow, whose run pages" });
    const passed = { ...actions, conclusion: "skipped" };
    expect(
      classify(
        "check_run",
        event({ action: "completed", check_run: passed }),
        ME,
      ),
    ).toEqual({
      signal: { ...at, type: "recovered", key: "check:check (node)" },
    });
    expect(checkRunOf(actions.html_url)).toBe(42);
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
        type: "health",
        branch: "main",
        fallback: {
          type: "failing",
          key: "issue:0",
          label: { key: "entry.bot", values: { title: "" } },
          url: "",
        },
      },
    });
    const nowhere = { installation: { id: 9 }, repository: { ...repository } };
    delete (nowhere.repository as { default_branch?: string }).default_branch;
    expect(
      classify("issues", { ...nowhere, action: "opened", issue }, ME),
    ).toMatchObject({ signal: { type: "health", branch: "" } });
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
        release: { dispatched: false },
      },
    });
  });

  it("names the run of a release that passes and whether it was started by hand, which decides whether it takes up a failed one", () => {
    const releaseOf = (run: object) =>
      (
        classify(
          "workflow_run",
          event({
            action: "completed",
            workflow_run: { ...workflow, conclusion: "success", ...run },
          }),
          ME,
        ) as { signal: { release: unknown } }
      ).signal.release;
    expect(releaseOf({ id: 4 })).toEqual({ run: 4, dispatched: false });
    expect(releaseOf({ id: 4, event: "schedule" })).toEqual({
      run: 4,
      dispatched: false,
    });
    expect(releaseOf({ id: 5, event: "workflow_dispatch" })).toEqual({
      run: 5,
      dispatched: true,
    });
    expect(releaseOf({ event: undefined })).toEqual({ dispatched: false });
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

  it("leaves other workflows and pull requests to the rules of every workflow, and drops runs that didn't end", () => {
    const ci = { ...workflow, id: 3, path: ".github/workflows/ci.yml" };
    expect(
      classify(
        "workflow_run",
        event({ action: "completed", workflow_run: ci }),
        ME,
      ),
    ).toMatchObject({ signal: { type: "workflow", failed: true } });
    const pull = { ...workflow, event: "pull_request" };
    expect(
      classify(
        "workflow_run",
        event({ action: "completed", workflow_run: pull }),
        ME,
      ),
    ).toEqual({ ignored: "a workflow run of a pull request" });
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
      ignored: "a workflow run of another branch",
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
      head: {
        ref: "release-please--branches--main",
        sha: "abc",
        repo: { full_name: "Dennis-Otto/demo" },
      },
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
    // New notes or a new title: the pager reads the pull request again.
    expect(
      classify(
        "pull_request",
        event({ action: "edited", pull_request: pull }),
        ME,
      ),
    ).toEqual({ signal: { ...at, type: "release-check", numbers: [30] } });
    // A fork may name its branch like release-please: its edit is no release.
    const { repo: _repo, ...nowhere } = pull.head;
    for (const head of [
      { ...pull.head, repo: { full_name: "mallory/demo" } },
      { ...pull.head, repo: null },
      nowhere,
    ]) {
      expect(
        classify(
          "pull_request",
          event({ action: "edited", pull_request: { ...pull, head } }),
          ME,
        ),
      ).toEqual({ ignored: "a pull request edited" });
    }
    expect(
      classify(
        "pull_request",
        event({
          action: "synchronize",
          pull_request: {
            head: {
              ref: "release-please--x",
              repo: { full_name: "Dennis-Otto/demo" },
            },
          },
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
    expect(
      classify(
        "release",
        event({
          action: "published",
          release: { tag_name: "v1.2.3", published_at: "2026-11-04T08:00:00Z" },
        }),
        ME,
      ),
    ).toStrictEqual({
      signal: {
        ...at,
        type: "release-published",
        tag: "v1.2.3",
        published: Date.parse("2026-11-04T08:00:00Z"),
      },
    });
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

  it("takes a pull request of a fork named like release-please as a contribution", () => {
    // Anyone can name the branch of a fork release-please--…, and a fork that runs
    // release-please gets one by itself: what it holds is someone else's code.
    const pull = {
      number: 31,
      title: "chore: release 9.9.9",
      html_url: "https://github.com/Dennis-Otto/demo/pull/31",
      user: stranger,
      head: {
        ref: "release-please--branches--main",
        sha: "abc",
        repo: { full_name: "octocat/demo" },
      },
    };
    const { repo: _repo, ...nowhere } = pull.head;
    for (const head of [pull.head, { ...pull.head, repo: null }, nowhere]) {
      const from = { ...pull, head };
      expect(
        classify(
          "pull_request",
          event({ action: "opened", pull_request: from }),
          ME,
        ),
      ).toEqual({
        signal: {
          ...at,
          type: "contribution",
          number: 31,
          pull: true,
          title: "chore: release 9.9.9",
          url: pull.html_url,
          author: "octocat",
        },
      });
      expect(
        classify(
          "pull_request",
          event({ action: "closed", pull_request: from }),
          ME,
        ),
      ).toEqual({
        signal: {
          ...at,
          type: "contribution-done",
          number: 31,
          reason: "closed",
        },
      });
      expect(
        classify(
          "pull_request",
          event({ action: "closed", pull_request: { ...from, merged: true } }),
          ME,
        ),
      ).toEqual({
        signal: {
          ...at,
          type: "contribution-done",
          number: 31,
          reason: "merged",
        },
      });
    }
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
      head: {
        ref: "release-please--branches--main",
        repo: { full_name: "Dennis-Otto/demo" },
      },
      base: { ref: "main", repo: { full_name: "Dennis-Otto/demo" } },
    };
    expect(why(ready, "main")).toBeNull();
    for (const repo of [{ full_name: "mallory/demo" }, null]) {
      expect(why({ ...ready, head: { ...ready.head, repo } }, "main")).toBe(
        "it comes from a fork",
      );
    }
    expect(why({ ...ready, state: "closed" }, "main")).toBe("it isn't open");
    expect(why({ ...ready, head: { ref: "feat/x" } }, "main")).toBe(
      "it isn't a release pull request",
    );
    expect(why({ ...ready, head: {} }, "main")).toBe(
      "it isn't a release pull request",
    );
    expect(
      why({ ...ready, base: { ...ready.base, ref: "next" } }, "main"),
    ).toBe("it doesn't go into main");
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

describe("workflows on the default branch", () => {
  const docs = {
    id: 51,
    name: "Docs",
    path: ".github/workflows/docs.yml",
    event: "push",
    conclusion: "failure",
    html_url: "https://github.com/Dennis-Otto/demo/actions/runs/51",
    head_branch: "main",
    head_repository: { full_name: "Dennis-Otto/demo" },
    run_attempt: 1,
  };
  const outcome = (run: object, action = "completed") =>
    classify(
      "workflow_run",
      event({ action, workflow_run: { ...docs, ...run } }),
      ME,
    );

  it("passes any workflow that failed or passed on the default branch on, with its attempt", () => {
    expect(outcome({})).toEqual({
      signal: {
        ...at,
        type: "workflow",
        path: ".github/workflows/docs.yml",
        name: "Docs",
        branch: "main",
        failed: true,
        run: 51,
        attempt: 1,
        url: "https://github.com/Dennis-Otto/demo/actions/runs/51/attempts/1",
      },
    });
    expect(outcome({ conclusion: "success", run_attempt: 2 })).toMatchObject({
      signal: { type: "workflow", failed: false, attempt: 2 },
    });
    for (const conclusion of ["timed_out", "startup_failure"]) {
      expect(outcome({ conclusion })).toMatchObject({
        signal: { failed: true },
      });
    }
  });

  it("counts the runs of a schedule, of a bot and of a start by hand on the default branch", () => {
    for (const each of [
      "schedule",
      "workflow_run",
      "workflow_dispatch",
      "issues",
      "dynamic",
    ]) {
      expect(outcome({ event: each })).toMatchObject({
        signal: { type: "workflow", failed: true },
      });
    }
  });

  it("drops the runs of pull requests, other branches and forks, which have checks of their own", () => {
    for (const each of ["pull_request", "pull_request_target"]) {
      expect(outcome({ event: each })).toEqual({
        ignored: "a workflow run of a pull request",
      });
    }
    // A release workflow of a pull request is one as well.
    expect(
      outcome({
        path: ".github/workflows/release.yml",
        event: "pull_request_target",
      }),
    ).toEqual({ ignored: "a workflow run of a pull request" });
    expect(
      outcome({ event: "workflow_dispatch", head_branch: "feat/x" }),
    ).toEqual({
      ignored: "a workflow run of another branch",
    });
    expect(outcome({ head_branch: null })).toEqual({
      ignored: "a workflow run of another branch",
    });
    const nowhere = { installation: { id: 9 }, repository: { ...repository } };
    delete (nowhere.repository as { default_branch?: string }).default_branch;
    expect(
      classify(
        "workflow_run",
        {
          ...nowhere,
          action: "completed",
          workflow_run: { ...docs, head_branch: "" },
        },
        ME,
      ),
    ).toEqual({ ignored: "a workflow run of another branch" });
    expect(outcome({ head_repository: { full_name: "octocat/demo" } })).toEqual(
      {
        ignored: "a workflow run of a fork",
      },
    );
    // A run that names no repository of its code is one of the repository itself.
    expect(outcome({ head_repository: null })).toMatchObject({
      signal: { type: "workflow" },
    });
  });

  it("passes a cancelled run on as neither a failure nor a pass, which only a rerun of 🔁 Rerun takes", () => {
    expect(outcome({ conclusion: "cancelled", run_attempt: 3 })).toEqual({
      signal: {
        ...at,
        type: "workflow",
        path: ".github/workflows/docs.yml",
        name: "Docs",
        branch: "main",
        failed: false,
        cancelled: true,
        run: 51,
        attempt: 3,
        url: "https://github.com/Dennis-Otto/demo/actions/runs/51/attempts/3",
      },
    });
    // A failure and a pass say nothing of a cancel.
    for (const conclusion of ["failure", "success"]) {
      expect(outcome({ conclusion })).not.toHaveProperty("signal.cancelled");
    }
    // A cancelled run of a pull request, of another branch or of a fork is still
    // nothing.
    expect(outcome({ conclusion: "cancelled", event: "pull_request" })).toEqual(
      { ignored: "a workflow run of a pull request" },
    );
  });

  it("drops a run that was skipped or didn't end, and one that names no run or no workflow", () => {
    for (const conclusion of ["skipped", "neutral", "action_required"]) {
      expect(outcome({ conclusion })).toEqual({
        ignored: `a workflow run that ended ${conclusion}`,
      });
    }
    expect(outcome({ conclusion: null })).toEqual({
      ignored: "a workflow run that ended ",
    });
    expect(outcome({ id: "51" })).toEqual({
      ignored: "a workflow run that names no run or no workflow",
    });
    expect(outcome({ path: undefined })).toEqual({
      ignored: "a workflow run that names no run or no workflow",
    });
    expect(outcome({}, "in_progress")).toEqual({
      ignored: "a workflow run in_progress",
    });
  });

  it("names a workflow without a name by its path, and an attempt that GitHub doesn't name as the first", () => {
    expect(
      outcome({ name: "", run_attempt: "2", html_url: undefined }),
    ).toMatchObject({
      signal: { name: ".github/workflows/docs.yml", attempt: 1, url: "" },
    });
    expect(outcome({ name: undefined, run_attempt: undefined })).toMatchObject({
      signal: {
        name: ".github/workflows/docs.yml",
        attempt: 1,
        url: docs.html_url,
      },
    });
  });

  it("means the same for a run that the pager reads itself", () => {
    expect(finishedRun(docs, at, "main")).toEqual(outcome({}));
    expect(finishedRun(docs, at, "develop")).toEqual({
      ignored: "a workflow run of another branch",
    });
    expect(finishedRun(undefined, at, "main")).toEqual({
      ignored: "a workflow run of another branch",
    });
  });
});

describe("the pictures of a visual change", () => {
  const sha = "a1b2c3d4e5f6";
  const check = {
    id: 31,
    name: "Visual check",
    path: ".github/workflows/visual.yml",
    event: "pull_request",
    conclusion: "success",
    head_sha: sha,
    pull_requests: [
      { number: 7, head: { sha: "0ld" } },
      { number: 8, head: { sha } },
    ],
  };
  const completed = (workflow_run: object) =>
    classify("workflow_run", event({ action: "completed", workflow_run }), ME);

  it("looks at a visual check that passed on a pull request, at its head", () => {
    expect(completed(check)).toEqual({
      signal: { ...at, type: "pictures", number: 8, sha, run: 31 },
    });
  });

  it("stays quiet for a visual check that failed, and takes one outside a pull request as any workflow", () => {
    expect(completed({ ...check, conclusion: "failure" })).toEqual({
      ignored: "a visual check that ended failure",
    });
    expect(
      completed({ ...check, event: "push", head_branch: "main" }),
    ).toMatchObject({ signal: { type: "workflow", failed: false } });
    expect(completed({ ...check, event: "pull_request_target" })).toEqual({
      ignored: "a workflow run of a pull request",
    });
    expect(
      classify(
        "workflow_run",
        event({ action: "requested", workflow_run: check }),
        ME,
      ),
    ).toEqual({ ignored: "a workflow run requested" });
  });

  it("stays quiet for a visual check of a fork, or of another head", () => {
    const none = {
      ignored: "a visual check of no pull request of the repository",
    };
    // GitHub names no pull request of a fork in the run.
    expect(completed({ ...check, pull_requests: [] })).toEqual(none);
    const { pull_requests: _pulls, ...forked } = check;
    expect(completed(forked)).toEqual(none);
    expect(completed({ ...check, head_sha: "other" })).toEqual(none);
    const { head_sha: _sha, ...headless } = check;
    expect(
      completed({ ...headless, pull_requests: [{ number: 8, head: {} }] }),
    ).toEqual(none);
    expect(completed({ ...check, pull_requests: [{ head: { sha } }] })).toEqual(
      none,
    );
    expect(completed({ ...check, id: "31" })).toEqual(none);
  });

  it("ends the pictures of a pull request of the maintainer or a bot that closed", () => {
    const pull = { number: 8, user: { login: "Dennis-Otto" }, merged: true };
    expect(
      classify(
        "pull_request",
        event({ action: "closed", pull_request: pull }),
        ME,
      ),
    ).toEqual({
      signal: { ...at, type: "pull-closed", number: 8, merged: true },
    });
    expect(
      classify(
        "pull_request",
        event({
          action: "closed",
          pull_request: { number: 9, user: bot, merged: false },
        }),
        ME,
      ),
    ).toEqual({
      signal: { ...at, type: "pull-closed", number: 9, merged: false },
    });
    expect(
      classify(
        "pull_request",
        event({ action: "closed", pull_request: { user: bot } }),
        ME,
      ),
    ).toEqual({
      signal: { ...at, type: "pull-closed", number: 0, merged: false },
    });
  });

  it("counts the pictures of an open pull request of the maintainer or a bot, at its head", () => {
    const repo = "Dennis-Otto/demo";
    const pull = {
      state: "open",
      user: { login: "dennis-otto", type: "User" },
      head: { sha, repo: { full_name: repo } },
    };
    expect(picturesBlocker(pull, repo, sha, ME)).toBeNull();
    expect(picturesBlocker({ ...pull, user: bot }, repo, sha, ME)).toBeNull();
    expect(picturesBlocker({ ...pull, state: "closed" }, repo, sha, ME)).toBe(
      "it isn't open",
    );
    expect(picturesBlocker(pull, repo, "newer", ME)).toBe(
      "it moved on to another head",
    );
    expect(
      picturesBlocker(
        { ...pull, head: { sha, repo: { full_name: "octocat/demo" } } },
        repo,
        sha,
        ME,
      ),
    ).toBe("it comes from a fork");
    expect(
      picturesBlocker({ ...pull, head: { sha, repo: null } }, repo, sha, ME),
    ).toBe("it comes from a fork");
    expect(picturesBlocker({ ...pull, user: stranger }, repo, sha, ME)).toBe(
      "someone else opened it",
    );
    expect(picturesBlocker({}, repo, sha, ME)).toBe("it isn't open");
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

  it("pages for an alert of a pull request once it reaches the default branch", () => {
    // Code scanning creates the alert in the analysis of the pull request, whose
    // ref is not the default branch; after the merge, GitHub sends no second
    // created but appeared_in_branch with the ref of the default branch.
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
    ).toMatchObject({
      signal: { type: "alert-open", key: "alert:4", url: alert.html_url },
    });
    const medium = {
      ...alert,
      rule: { ...alert.rule, security_severity_level: "medium" },
    };
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "appeared_in_branch", alert: medium, ref }),
        ME,
      ),
    ).toEqual({ ignored: "an alert of severity medium" });
    // A person's dismissal holds on every branch, also one the alert reaches later.
    expect(
      classify(
        "code_scanning_alert",
        event({
          action: "appeared_in_branch",
          alert: { ...alert, state: "dismissed" },
          ref,
        }),
        ME,
      ),
    ).toEqual({ ignored: "a dismissed alert" });
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
        event({ action: "appeared_in_branch", alert, ref: "refs/heads/topic" }),
        ME,
      ),
    ).toEqual({ ignored: "an alert of another branch" });
    expect(
      classify(
        "code_scanning_alert",
        event({ action: "edited", alert, ref }),
        ME,
      ),
    ).toEqual({ ignored: "an alert edited" });
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
      "issue_comment",
      "pull_request_review",
      "pull_request_review_comment",
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
