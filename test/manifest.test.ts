// The manifest of the GitHub App: the least permissions that the pager needs, and
// exactly the events that its rules read, so that the app asks for nothing more.
import { describe, expect, it } from "vitest";

import text from "../github-app.json?raw";
import { classify } from "../src/rules.ts";

const manifest = JSON.parse(text) as {
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
};

describe("the manifest of the GitHub App", () => {
  it("is private and asks only for what the pager uses", () => {
    expect(manifest.public).toBe(false);
    expect(manifest.default_permissions).toEqual({
      // The events of workflow runs, for a release that fails, and 🔁 Rerun,
      // which reads a run that failed and runs its failed jobs again.
      actions: "write",
      // The events of checks: a required check that fails on main, and a release
      // whose checks finished.
      checks: "read",
      // The merge of a release, and the events to the control repository.
      contents: "write",
      issues: "read",
      metadata: "read",
      pull_requests: "read",
      // The events of code scanning.
      security_events: "read",
    });
  });

  it("subscribes to exactly the events that the rules read", () => {
    const repository = { full_name: "a/b", owner: { login: "a" } };
    for (const event of manifest.default_events) {
      const outcome = classify(
        event,
        { repository, installation: { id: 1 } },
        "a",
      );
      expect(outcome).not.toEqual({ ignored: `the event ${event}` });
    }
    expect(manifest.default_events).toHaveLength(7);
  });
});
