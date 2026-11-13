Repo Pager: A Telegram bot on a Cloudflare Worker that tells its maintainer only what needs them in their GitHub repositories, and acts on it with a button.

Repo Pager is self-hosted: everyone who uses it runs an instance of their own, a copy of this repository with their own bot of Telegram, their own Worker on Cloudflare, their own GitHub App and their own private control repository, set up by `docs/setup.md`. There is no shared app and no central service: a reporter's pager is theirs, and the maintainer can't see its logs, its state or its secrets.

Where things are:

- The Worker is in `src/`, its metadata and version in `package.json`, and the values of one instance, the name of the Worker and its variables such as `LANGUAGE`, in `wrangler.jsonc`.
- `src/rules.ts` decides what pages and what doesn't, `src/pager.ts` turns it into one message per thing, `src/buttons.ts` and `src/actions.ts` are the buttons, `src/topics.ts` and `src/updates.ts` the chat of Telegram, and `src/control.ts` the contract with the control repository, whose workflows come from the public template Dennis-Otto/repo-pager-control-template.
- `README.md` documents what the pager does; the website, from `docs/`, has the set-up (`docs/setup.md`), how it works (`docs/how-it-works.md`) and the releases (`docs/releases.md`). `CHANGELOG.md` lists the changes of every release.
- The tests are in `test/`; `scripts/check.sh` runs every check.

The areas of an issue: the Worker and its rules, Telegram and its topics, the buttons, the control repository, the set-up and the deployment, and the website.

What matters in a bug report: the release that the reporter's copy runs, which `/status` names; the step of the set-up or the message and button involved; and the relevant lines of the log, without tokens, keys, chat ids or private URLs: the Worker's from `npx wrangler tail` or the Logs of the Worker on the dashboard of Cloudflare, and the run of the control repository's workflow when one of its jobs is involved. Many problems of a new instance are a missing secret, a webhook without its secret or an app that lacks a permission or an event: `/status` and `docs/setup.md` name the fix of each.
