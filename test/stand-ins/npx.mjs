// A stand-in for `npx`, which test/register-app-script.mjs puts first on the PATH of
// scripts/register-app.mjs: it writes its arguments and what it read on stdin as
// one line of JSON to the file STAND_IN_LOG and succeeds, or fails as Wrangler
// would when its arguments start with those of STAND_IN_FAIL, such as
// "--no -- wrangler secret list".
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const input = Buffer.concat(chunks).toString("utf8");
appendFileSync(
  process.env.STAND_IN_LOG ?? "",
  `${JSON.stringify({ args, input })}\n`,
);
const fail = process.env.STAND_IN_FAIL;
if (fail && args.join(" ").startsWith(fail)) {
  console.error("✘ [ERROR] A request to the Cloudflare API failed.");
  process.exit(1);
}
