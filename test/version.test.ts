// The version of the pager: the Worker knows which release it runs, notes each
// release of its own repository that it doesn't run yet, and tells the maintainer
// once when Workers Builds didn't deploy it in time; a Worker of that release
// takes the note back.
import { describe, expect, it } from "vitest";

import { health } from "../src/health.ts";
import { apply } from "../src/pager.ts";
import { runSchedule } from "../src/schedule.ts";
import {
  checkDeployed,
  DEPLOY_WITHIN,
  isBehind,
  noteRelease,
  OWN,
  RELEASED,
  type Released,
  repositoryOf,
  VERSION,
} from "../src/version.ts";
import { START, type World, world } from "./helpers.ts";

const MINUTE = 60 * 1000;

/** A version above the one that runs, as the next release has it. */
const NEXT = `${Number(VERSION.split(".")[0]) + 1}.0.0`;

const at = { repo: "Dennis-Otto/repo-pager", installation: 9 };

function noted(w: World): Promise<Released | null | undefined> {
  return w.context.local.get<Released | null>(RELEASED);
}

describe("the version of the pager", () => {
  it("is that of package.json, whose repository is the pager's own", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(OWN).toBe("Dennis-Otto/repo-pager");
    expect(repositoryOf("https://github.com/someone/pager")).toBe(
      "someone/pager",
    );
    expect(repositoryOf("git+https://gitlab.com/someone/pager.git")).toBe(null);
  });

  it("is behind a release only by a higher number", () => {
    expect(isBehind("1.2.3", "1.2.4")).toBe(true);
    expect(isBehind("1.2.3", "1.10.0")).toBe(true);
    expect(isBehind("1.9.9", "2.0.0")).toBe(true);
    expect(isBehind("1.2.3", "1.2.3")).toBe(false);
    expect(isBehind("1.3.0", "1.2.9")).toBe(false);
    expect(isBehind("1.2.3", "1.3.0-beta.1")).toBe(false);
    expect(isBehind("1.2.3", "latest")).toBe(false);
  });
});

describe("a release of the pager", () => {
  it("is noted when it is one of the pager's own repository that the Worker doesn't run yet", async () => {
    const w = await world();
    expect(await noteRelease(w.context, "Dennis-Otto/demo", `v${NEXT}`)).toBe(
      false,
    );
    expect(await noteRelease(w.context, at.repo, `v${NEXT}`, null)).toBe(false);
    expect(await noteRelease(w.context, at.repo, `v${VERSION}`)).toBe(false);
    expect(await noted(w)).toBeUndefined();

    // The event of GitHub, through the rules: the name of the repository in any case.
    expect(
      await apply(w.context, {
        ...at,
        repo: "dennis-otto/Repo-Pager",
        type: "release-published",
        tag: `v${NEXT}`,
      }),
    ).toBe("no release shown");
    expect(await noted(w)).toEqual({ version: NEXT, at: START });
    // The same event again keeps the time of the first.
    w.clock.now = START + MINUTE;
    expect(await noteRelease(w.context, at.repo, NEXT)).toBe(false);
    expect(await noted(w)).toEqual({ version: NEXT, at: START });
    expect((await health(w.context)).release).toEqual({
      version: NEXT,
      at: "2026-11-04T08:00:00.000Z",
    });
  });

  it("that didn't go live in time is told once, in a message of its own", async () => {
    const w = await world();
    await noteRelease(w.context, at.repo, `v${NEXT}`);
    w.clock.now = START + DEPLOY_WITHIN - MINUTE;
    await runSchedule(w.context);
    expect(w.net.telegram("sendMessage")).toHaveLength(0);

    w.clock.now = START + DEPLOY_WITHIN;
    await runSchedule(w.context);
    const sent = w.net.telegram("sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.text).toBe(
      `⚠️ The release ${NEXT} of the pager came out on 2026-11-04 at 08:00 UTC, but the Worker still runs version ${VERSION}: Workers Builds didn't deploy it. Its log in Cloudflare says why, and docs/releases.md under “When a build fails” what to do.`,
    );
    expect(sent[0]?.body.reply_markup).toEqual({ inline_keyboard: [] });
    expect(await noted(w)).toEqual({ version: NEXT, at: START, told: true });

    w.clock.now = START + 2 * DEPLOY_WITHIN;
    await runSchedule(w.context);
    expect(w.net.telegram("sendMessage")).toHaveLength(1);
  });

  it("is taken back by a Worker that runs it", async () => {
    const w = await world();
    await w.context.local.put<Released>(RELEASED, {
      version: VERSION,
      at: START - DEPLOY_WITHIN,
      told: true,
    });
    expect((await health(w.context)).release).toBe(null);
    await checkDeployed(w.context);
    expect(await noted(w)).toBe(null);
    await checkDeployed(w.context);
    expect(w.net.telegram("sendMessage")).toHaveLength(0);
  });
});
