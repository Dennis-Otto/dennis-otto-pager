#!/usr/bin/env node
// Registers the GitHub App of the pager from github-app.json, its manifest, with
// the webhook at the address of the Worker: you confirm one page on GitHub, and
// the App ID, the private key and the secret of the webhook go straight into the
// secrets of the Worker with `wrangler secret put`, without a file or an output
// that holds them. docs/setup.md shows the step in its order.
//
//   node scripts/register-app.mjs https://repo-pager.ACCOUNT.workers.dev
//
// The app belongs to your personal account. With `--org ORGANIZATION`, it belongs
// to that organization instead, whose apps you may manage, so that it can be
// installed on the organization's repositories; docs/setup.md says which to take.
//
// It needs `npx wrangler login` and the deployed Worker before, as docs/setup.md
// shows, and checks both with `wrangler secret list` before it sends the manifest:
// GitHub hands out the private key and the secret of the webhook only once, so
// they must have a place to go. Should Wrangler still fail to store one, the
// script names the secrets that are stored and those that are missing, and how to
// recover. test/register-app-script.mjs runs it with a stand-in for npx.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import {
  conversionFailed,
  newAppPage,
  recovery,
  registration,
  USAGE,
  WRANGLER_NOT_READY,
} from "./app-address.ts";

const asked = registration(process.argv.slice(2));
if (typeof asked === "string") {
  console.error(asked);
  console.error(`Usage: ${USAGE}`);
  process.exit(2);
}
const { worker, organization } = asked;

const manifest = JSON.parse(
  readFileSync(new URL("../github-app.json", import.meta.url), "utf8"),
);
const state = randomBytes(16).toString("hex");

function htmlText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Runs `npx wrangler ARGS` with the input on its stdin, or with none, which keeps
// Wrangler from asking anything; what it says on stderr reaches the terminal.
function wrangler(args, input, output = "inherit") {
  return new Promise((resolve) => {
    const child = spawn("npx", ["--no", "--", "wrangler", ...args], {
      stdio: [input === undefined ? "ignore" : "pipe", output, "inherit"],
      shell: process.platform === "win32",
    });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(false);
    });
    child.on("exit", (code) => resolve(code === 0));
    child.stdin?.end(input);
  });
}

async function convert(code) {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "repo-pager",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} to the conversion`);
  }
  return response.json();
}

let converting = false;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const page = (status, body) => {
    response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    // Once the last page is sent, the browser's open connections end too, so
    // that the script ends at once rather than when they time out.
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Pager app</title>${body}`,
      () => server.listening || server.closeIdleConnections(),
    );
  };
  if (url.pathname === "/") {
    const form = htmlText(JSON.stringify(manifest));
    page(
      200,
      `<form method="post" action="${htmlText(newAppPage(organization, state))}">
<input type="hidden" name="manifest" value="${form}">
<p>This page sends the manifest of the pager's GitHub App to GitHub, where you confirm it.</p>
<button>Create the app on GitHub</button></form>
<script>document.forms[0].submit()</script>`,
    );
    return;
  }
  if (url.pathname !== "/done" || url.searchParams.get("state") !== state) {
    page(404, "<p>Not here.</p>");
    return;
  }
  // The code of the manifest converts once. server.close() turns away new
  // connections only: a reload of this page on a connection the browser keeps
  // open still reaches here, and gets told to wait for the first one.
  if (converting) {
    page(409, "<p>The app is being registered: see the terminal.</p>");
    return;
  }
  converting = true;
  server.close();
  const failed = (message) => {
    page(
      500,
      message
        .split("\n")
        .map((line) => `<p>${htmlText(line)}</p>`)
        .join("\n"),
    );
    console.error(message);
    process.exitCode = 1;
  };
  let app;
  try {
    app = await convert(url.searchParams.get("code") ?? "");
  } catch (error) {
    failed(conversionFailed(organization, error.message));
    return;
  }
  const values = {
    GITHUB_APP_ID: String(app.id),
    GITHUB_APP_PRIVATE_KEY: app.pem,
    GITHUB_WEBHOOK_SECRET: app.webhook_secret,
  };
  const stored = [];
  for (const [name, value] of Object.entries(values)) {
    if (!(await wrangler(["secret", "put", name], value))) {
      console.error(`wrangler secret put ${name} failed.`);
      failed(recovery(organization, app.slug, stored));
      return;
    }
    stored.push(name);
  }
  const install = `${app.html_url}/installations/new`;
  page(
    200,
    `<p>The app ${htmlText(app.slug)} exists, and its secrets are in the Worker.</p>
<p>Now <a href="${htmlText(install)}">install it</a> on your repositories and on the control repository.</p>`,
  );
  console.log(`Done. Install the app: ${install}`);
});

// Before GitHub creates the app: Wrangler must be signed in and reach the Worker,
// or the secrets that GitHub hands out once would have nowhere to go.
// `wrangler whoami` can't tell, since it succeeds without a sign-in as well.

if (!(await wrangler(["secret", "list"], undefined, "ignore"))) {
  console.error(WRANGLER_NOT_READY);
  process.exit(1);
}

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  manifest.hook_attributes.url = `${worker}/github`;
  manifest.redirect_url = `http://127.0.0.1:${port}/done`;
  console.log(
    `Open http://127.0.0.1:${port}/ in the browser that is signed in to GitHub.`,
  );
});
