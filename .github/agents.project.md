# Notes of this project for coding agents

Dennis Otto Pager: A Telegram bot on a Cloudflare Worker that tells its maintainer only what needs them in their GitHub repositories, and acts on it with a button.

This file belongs to the project: the blueprint wrote it once, and its updates leave it alone. It adds to `AGENTS.md` what a coding agent needs to know about this project alone, such as its architecture, the commands of its own checks and what to watch for in its tests.

## Where things are

- The Worker is in `src/`, with its handlers in `src/index.ts`, its metadata and version in `package.json`, and its name, bindings and compatibility date in `wrangler.jsonc`; Cloudflare builds and deploys it with Workers Builds, as `docs/releases.md` describes, and its secrets live in Cloudflare, never in the repository.
- `README.md` documents installation, configuration and use, `docs/` holds the pages of the website, and `CHANGELOG.md` lists the changes of every release.
- The tests are in `test/`; `scripts/check.sh` runs every check.
