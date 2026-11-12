// The tests of the Worker once more, as another instance would run them: with the
// bindings of wrangler.jsonc, but another maintainer, another control repository,
// the other language, no day for the token of Claude and another time for "Later".
// wrangler.jsonc holds the values of one instance, those of the maintainer's own,
// and docs/setup.md asks everyone who runs a copy to set theirs there, so the tests
// have to pass with any of them: scripts/check-project.sh runs them with this
// configuration, and a test that holds on to the values of one instance fails there.
//
// `npx vitest run --config scripts/another-instance.config.ts` runs it alone. It
// measures no coverage: vitest.config.ts, the configuration of `npm test`, does.
import { readFileSync } from "node:fs";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The language of wrangler.jsonc decides the other one: "de" there runs these in
// English, any other value in German, so that both languages run, whichever the
// instance sets.
const language = /"LANGUAGE"\s*:\s*"([^"]*)"/.exec(
  readFileSync("wrangler.jsonc", "utf8"),
)?.[1];

// The values of an instance that nobody runs, for each var of wrangler.jsonc that
// docs/setup.md asks a copy to set, so that none of them is that of wrangler.jsonc.
const ANOTHER_INSTANCE = {
  MAINTAINER_LOGIN: "another-maintainer",
  OWNERS: "another-organization",
  CONTROL_REPOSITORY: "another-maintainer/pager-control",
  LANGUAGE: language?.trim().toLowerCase() === "de" ? "en" : "de",
  CLAUDE_TOKEN_EXPIRES: "",
  LATER_HOURS: "1",
};

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "wrangler.jsonc" },
      miniflare: { bindings: ANOTHER_INSTANCE },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
