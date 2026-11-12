// Runs scripts/register-app.mjs as you do in step 4 of docs/setup.md, with a
// stand-in for npx first on its PATH (test/stand-ins/npx.mjs) and one for the
// conversion of the manifest by GitHub (test/stand-ins/github.mjs), and plays the
// browser: it opens the page of the form and comes back as GitHub redirects.
// scripts/check-project.sh runs it with `node --test`, since the tests of
// `npm test` run in workerd, which starts no process.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { APP } from "./stand-ins/app.mjs";

const SCRIPT = fileURLToPath(
  new URL("../scripts/register-app.mjs", import.meta.url),
);
const NPX = fileURLToPath(new URL("./stand-ins/npx.mjs", import.meta.url));
const GITHUB = new URL("./stand-ins/github.mjs", import.meta.url).href;
const WORKER = "https://repo-pager.octocat.workers.dev";
const SECRETS = [APP.pem, APP.webhook_secret, ...APP.pem.split("\n")].filter(
  Boolean,
);

// A folder with `npx` for the shells of Linux and macOS and `npx.cmd` for that of
// Windows, both of which run the stand-in with this Node.
function standInFolder() {
  const folder = mkdtempSync(join(tmpdir(), "register-app-"));
  writeFileSync(
    join(folder, "npx"),
    `#!/bin/sh\nexec "${process.execPath}" "${NPX}" "$@"\n`,
  );
  chmodSync(join(folder, "npx"), 0o755);
  writeFileSync(
    join(folder, "npx.cmd"),
    `@"${process.execPath}" "${NPX}" %*\r\n`,
  );
  return folder;
}

/**
 * Starts the script with the arguments and the variables of the stand-ins, and
 * returns what it printed, its code and each call of npx once it ends. With
 * `browse`, it opens the page that the script prints, as the browser would.
 */
async function register(args, standIns, browse = async () => {}) {
  const folder = standInFolder();
  const log = join(folder, "npx.log");
  writeFileSync(log, "");
  const env = { ...process.env, ...standIns, STAND_IN_LOG: log };
  const path = Object.keys(env).find((key) => key.toUpperCase() === "PATH");
  env[path ?? "PATH"] = `${folder}${delimiter}${env[path] ?? ""}`;
  const child = spawn(process.execPath, ["--import", GITHUB, SCRIPT, ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let browsed = null;
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
    const address = /Open (http:\/\/127\.0\.0\.1:\d+)\//.exec(output)?.[1];
    if (address !== undefined && browsed === null) {
      // A browser that fails ends the script, which would wait for it.
      browsed = browse(address).catch((error) => {
        child.kill();
        throw error;
      });
    }
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  const pages = (await browsed) ?? [];
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { code, output, pages, calls };
}

/** The browser: the form, a wrong state, then the redirect of GitHub. */
async function confirm(address) {
  const form = await fetch(`${address}/`);
  const body = await form.text();
  const state = /\?state=([0-9a-f]{32})"/.exec(body)?.[1];
  const wrong = await fetch(`${address}/done?state=0${state}&code=the-code`);
  const done = await fetch(`${address}/done?state=${state}&code=the-code`);
  return [
    { status: form.status, body },
    { status: wrong.status, body: await wrong.text() },
    { status: done.status, body: await done.text() },
  ];
}

const LIST = ["--no", "--", "wrangler", "secret", "list"];
const put = (name) => ["--no", "--", "wrangler", "secret", "put", name];

function assertNoSecret(result) {
  const shown = [result.output, ...result.pages.map((page) => page.body)];
  for (const text of shown) {
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret), `a secret reached the output: ${text}`);
    }
  }
}

describe("scripts/register-app.mjs", () => {
  it("stores the three secrets of the app over stdin, after Wrangler proved ready", async () => {
    const result = await register([WORKER], {}, confirm);
    assert.equal(result.code, 0, result.output);
    const [form, wrong, done] = result.pages;
    assert.equal(form.status, 200);
    assert.match(
      form.body,
      /https:\/\/github\.com\/settings\/apps\/new\?state=/,
    );
    assert.match(form.body, /repo-pager\.octocat\.workers\.dev\/github/);
    assert.equal(wrong.status, 404);
    assert.equal(done.status, 200);
    assert.match(done.body, /apps\/repo-pager-of-octocat\/installations\/new/);
    assert.deepEqual(result.calls, [
      { args: LIST, input: "" },
      { args: put("GITHUB_APP_ID"), input: "4242" },
      { args: put("GITHUB_APP_PRIVATE_KEY"), input: APP.pem },
      { args: put("GITHUB_WEBHOOK_SECRET"), input: APP.webhook_secret },
    ]);
    assert.match(
      result.output,
      /Done\. Install the app: https:\/\/github\.com/,
    );
    assertNoSecret(result);
  });

  it("stops before GitHub creates the app when Wrangler can't reach the Worker", async () => {
    const result = await register(
      [WORKER],
      { STAND_IN_FAIL: LIST.join(" ") },
      async () => assert.fail("the script served the form"),
    );
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, [{ args: LIST, input: "" }]);
    assert.match(result.output, /npx wrangler login/);
    assert.match(result.output, /Nothing was created on GitHub\./);
  });

  it("names the stored and the missing secrets when a put fails", async () => {
    const result = await register(
      [WORKER, "--org", "octo-org"],
      { STAND_IN_FAIL: put("GITHUB_APP_PRIVATE_KEY").join(" ") },
      confirm,
    );
    assert.equal(result.code, 1);
    assert.deepEqual(
      result.calls.map((call) => call.args),
      [LIST, put("GITHUB_APP_ID"), put("GITHUB_APP_PRIVATE_KEY")],
    );
    const done = result.pages[2];
    assert.equal(done.status, 500);
    for (const text of [result.output, done.body]) {
      assert.match(
        text,
        /Stored: GITHUB_APP_ID\. Missing: GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET\./,
      );
      assert.match(
        text,
        /github\.com\/organizations\/octo-org\/settings\/apps\/repo-pager-of-octocat\/advanced/,
      );
    }
    assert.match(
      result.output,
      /wrangler secret put GITHUB_APP_PRIVATE_KEY failed/,
    );
    assertNoSecret(result);
  });

  it("says that nothing is stored when the conversion fails", async () => {
    const result = await register(
      [WORKER],
      { STAND_IN_CONVERSION: "422" },
      confirm,
    );
    assert.equal(result.code, 1);
    assert.equal(result.pages[2].status, 500);
    assert.deepEqual(result.calls, [{ args: LIST, input: "" }]);
    assert.match(result.output, /GitHub answered 422 to the conversion\./);
    assert.match(result.output, /Nothing is stored in the Worker\./);
  });

  it("explains its arguments without calling Wrangler", async () => {
    const result = await register([], {});
    assert.equal(result.code, 2);
    assert.deepEqual(result.calls, []);
    assert.match(result.output, /Usage: node scripts\/register-app\.mjs/);
  });
});
