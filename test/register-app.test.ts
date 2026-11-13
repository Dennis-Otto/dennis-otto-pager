// The arguments of scripts/register-app.mjs and the page of GitHub where it
// registers the app: of the personal account, or of an organization with --org.
import { describe, expect, it } from "vitest";

import {
  APP_SECRETS,
  appSettingsPage,
  appsPage,
  conversionFailed,
  newAppPage,
  recovery,
  registration,
  WRANGLER_NOT_READY,
} from "../scripts/app-address.ts";

const WORKER = "https://repo-pager.octocat.workers.dev";

describe("the registration of the GitHub App", () => {
  it("registers the app of a Worker for the personal account", () => {
    expect(registration([`${WORKER}//`])).toEqual({
      worker: WORKER,
      organization: null,
    });
    expect(newAppPage(null, "f00d")).toBe(
      "https://github.com/settings/apps/new?state=f00d",
    );
  });

  it("registers it for an organization with --org", () => {
    const asked = { worker: WORKER, organization: "octo-org" };
    expect(registration([WORKER, "--org", "octo-org"])).toEqual(asked);
    expect(registration(["--org=octo-org", WORKER])).toEqual(asked);
    expect(newAppPage("octo-org", "f00d")).toBe(
      "https://github.com/organizations/octo-org/settings/apps/new?state=f00d",
    );
  });

  it("says what is wrong with the arguments", () => {
    expect(registration([])).toMatch(/^Name the address of the Worker/);
    expect(registration(["http://insecure.example"])).toMatch(
      /^Name the address of the Worker/,
    );
    expect(registration([WORKER, "--org"])).toMatch(/^Name the organization/);
    expect(registration([WORKER, "--org", "octo/org"])).toMatch(
      /^Name the organization/,
    );
    expect(registration([WORKER, "--org", "--help"])).toMatch(
      /^Name the organization/,
    );
    expect(registration([WORKER, "--orgs"])).toBe("Unknown option --orgs");
    expect(registration([WORKER, WORKER])).toBe(
      `One address of the Worker, not also ${WORKER}`,
    );
  });

  it("names the pages of the app in its account", () => {
    expect(appsPage(null)).toBe("https://github.com/settings/apps");
    expect(appSettingsPage("octo-org", "repo-pager-of-octocat")).toBe(
      "https://github.com/organizations/octo-org/settings/apps/repo-pager-of-octocat",
    );
  });

  it("says how to recover the secrets that didn't reach the Worker", () => {
    const text = recovery(null, "my-pager", ["GITHUB_APP_ID"]);
    expect(text).toContain(
      "Stored: GITHUB_APP_ID. Missing: GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET.",
    );
    expect(text).toContain(
      "open https://github.com/settings/apps/my-pager and",
    );
    expect(text).toContain("npx wrangler secret put GITHUB_APP_PRIVATE_KEY <");
    expect(text).toContain("npx wrangler secret put GITHUB_WEBHOOK_SECRET`");
    expect(text).not.toContain("secret put GITHUB_APP_ID");
    expect(text).toContain(
      "delete the app at https://github.com/settings/apps/my-pager/advanced",
    );
    const none = recovery("octo-org", "my-pager", []);
    expect(none).toContain(`Stored: none. Missing: ${APP_SECRETS.join(", ")}.`);
    expect(none).toContain("copy its App ID");
    expect(none).toContain("/organizations/octo-org/settings/apps/my-pager");
  });

  it("says what to do when the conversion fails or Wrangler isn't ready", () => {
    expect(conversionFailed("octo-org", "GitHub answered 404")).toBe(
      "GitHub answered 404. Nothing is stored in the Worker.\nIf https://github.com/organizations/octo-org/settings/apps lists the new app, delete it on its page Advanced, then run the script again.",
    );
    expect(WRANGLER_NOT_READY).toContain("npx wrangler login");
    expect(WRANGLER_NOT_READY).toContain("Nothing was created on GitHub.");
  });
});
