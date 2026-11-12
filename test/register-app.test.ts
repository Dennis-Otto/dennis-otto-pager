// The arguments of scripts/register-app.mjs and the page of GitHub where it
// registers the app: of the personal account, or of an organization with --org.
import { describe, expect, it } from "vitest";

import { newAppPage, registration } from "../scripts/app-address.ts";

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
});
