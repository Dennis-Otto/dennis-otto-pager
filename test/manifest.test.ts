// The manifest of the GitHub App: the least permissions that the pager needs, and
// exactly the events that its rules read, so that the app asks for nothing more.
import { describe, expect, it } from "vitest";

import text from "../github-app.json?raw";
import { classify } from "../src/rules.ts";

const manifest = JSON.parse(text) as {
  name: string;
  description: string;
  public: boolean;
  default_permissions: Record<string, string>;
  default_events: string[];
};

describe("the manifest of the GitHub App", () => {
  it("names the product, which each user registers as an app of their own", () => {
    // GitHub shows the name on the page of the manifest, where the user changes it
    // to one of their own: an app's name is unique on GitHub, at most 34 characters.
    expect(manifest.name).toBe("Repo Pager");
    expect(manifest.name.length).toBeLessThanOrEqual(34);
    // The description speaks of whoever runs the pager, not of one person.
    expect(manifest.description).toMatch(/^Pages its maintainer /);
    expect(manifest.description).not.toMatch(/dennis/i);
  });

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
      // The events of discussions, and ✅ Send of a reply in one, as the app.
      discussions: "write",
      // The events of issues and of their comments.
      issues: "read",
      metadata: "read",
      pull_requests: "read",
      // The private vulnerability reports, and the state of one in triage,
      // which the reminder on the day before its acknowledgement reads.
      repository_advisories: "read",
      // The alerts of secret scanning, and the file of each.
      secret_scanning_alerts: "read",
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
    expect(manifest.default_events).toHaveLength(12);
  });
});
