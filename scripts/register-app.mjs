#!/usr/bin/env node
// Registers the GitHub App of the pager from github-app.json, its manifest, with
// the webhook at the address of the Worker: you confirm one page on GitHub, and
// the App ID, the private key and the secret of the webhook go straight into the
// secrets of the Worker with `wrangler secret put`, without a file or an output
// that holds them. docs/setup.md shows the step in its order.
//
//   node scripts/register-app.mjs https://dennis-otto-pager.ACCOUNT.workers.dev
//
// It needs `npx wrangler login` before, as the first deployment does.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const worker = process.argv[2]?.replace(/\/+$/, "") ?? "";
if (!/^https:\/\/[a-z0-9.-]+$/i.test(worker)) {
  console.error(
    "Name the address of the Worker, such as https://dennis-otto-pager.ACCOUNT.workers.dev",
  );
  process.exit(2);
}

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

function put(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["--no", "--", "wrangler", "secret", "put", name],
      {
        stdio: ["pipe", "inherit", "inherit"],
        shell: process.platform === "win32",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`wrangler secret put ${name} failed`)),
    );
    child.stdin.end(value);
  });
}

async function convert(code) {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "dennis-otto-pager",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} to the conversion`);
  }
  return response.json();
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const page = (status, body) => {
    response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Pager app</title>${body}`,
    );
  };
  if (url.pathname === "/") {
    const form = htmlText(JSON.stringify(manifest));
    page(
      200,
      `<form method="post" action="https://github.com/settings/apps/new?state=${state}">
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
  try {
    const app = await convert(url.searchParams.get("code") ?? "");
    await put("GITHUB_APP_ID", String(app.id));
    await put("GITHUB_APP_PRIVATE_KEY", app.pem);
    await put("GITHUB_WEBHOOK_SECRET", app.webhook_secret);
    const install = `${app.html_url}/installations/new`;
    page(
      200,
      `<p>The app ${htmlText(app.slug)} exists, and its secrets are in the Worker.</p>
<p>Now <a href="${htmlText(install)}">install it</a> on your repositories and on the control repository.</p>`,
    );
    console.log(`Done. Install the app: ${install}`);
  } catch (error) {
    page(500, `<p>${htmlText(String(error.message))}</p>`);
    console.error(error.message);
    process.exitCode = 1;
  }
  server.close();
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  manifest.hook_attributes.url = `${worker}/github`;
  manifest.redirect_url = `http://127.0.0.1:${port}/done`;
  console.log(
    `Open http://127.0.0.1:${port}/ in the browser that is signed in to GitHub.`,
  );
});
