# Notes of this project for coding agents

Dennis Otto Pager: A Telegram bot on a Cloudflare Worker that tells its maintainer only what needs them in their GitHub repositories, and acts on it with a button.

This file belongs to the project: the blueprint wrote it once, and its updates leave it alone. It adds to `AGENTS.md` what a coding agent needs to know about this project alone, such as its architecture, the commands of its own checks and what to watch for in its tests.

## Where things are

- The Worker is in `src/`, with its handlers in `src/index.ts`, its metadata and version in `package.json`, and its name, bindings and compatibility date in `wrangler.jsonc`; Cloudflare builds and deploys it with Workers Builds, as `docs/releases.md` describes, and its secrets live in Cloudflare, never in the repository.
- `README.md` documents installation, configuration and use, `docs/` holds the pages of the website, and `CHANGELOG.md` lists the changes of every release.
- The tests are in `test/`; `scripts/check.sh` runs every check.

## The parts of the pager

- `src/index.ts` has the three routes and the schedule; each request proves where it comes from first (`src/crypto.ts`), and `src/settings.ts` reads the variables of `wrangler.jsonc` and the secrets, which live in Cloudflare.
- `src/rules.ts` is the one place that decides what counts: add or change a rule there, with its test in `test/rules.test.ts`, and keep `docs/how-it-works.md` and its German page in step. `github-app.json`, the manifest of the GitHub App, subscribes to exactly the events that the rules read, as `test/manifest.test.ts` checks.
- `src/buttons.ts` is the allowlist of the buttons per kind and state; `src/actions.ts` runs them. A new action takes an entry in both, a test of its own and a row in the docs. Nothing that an issue, a pull request or the control repository says runs: it is shown, escaped by `src/render.ts`.
- `src/pager.ts` turns signals into one message per thing, edited in place; `src/store.ts` keeps the state in Workers KV, without secrets. Mind the free plan of KV: write only when a thing changes.
- `src/topics.ts` gives each thing a topic of the chat: its first message opens it, its name gets ✅ once the thing is done, and a text in it goes to the control repository with the thing (`about()`). Every failure of a topic falls back to the main view, as before topics; the tests fake Telegram's topics with `withTopics()` of `test/helpers.ts`, and a `Net` without it is a chat without topics.
- `src/texts.ts` holds every text that goes to the maintainer, one catalog per language, chosen by `LANGUAGE` in `wrangler.jsonc`: a new or changed text takes its entry in both catalogs, with the same placeholders, tags and emojis, as `test/texts.test.ts` checks. The rules return what they mean as a `Phrase` of that catalog, never words, and the logs stay in English.
- `src/control.ts` takes the signed answers of the private control repository: a draft, a note, a proposal with one ✅ Confirm button that carries the data of its thing's own button, and the end of a job that failed. The contract is in `docs/how-it-works.md`, and the workflow on the other side is in the private repository `Dennis-Otto/dennis-otto-pager-control`: a change of the contract changes both, the Worker first, since it refuses a body that it doesn't know.
- The tests run in workerd against the simulated Telegram and GitHub of `test/helpers.ts`, which records each call; nothing goes to the network.
