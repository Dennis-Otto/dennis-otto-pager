# The pager watches the repositories of owners beside its maintainer

- Status: accepted
- Date: 2026-11-12

## Context

The pager served only the repositories whose owner is `MAINTAINER_LOGIN`: `where()` of `src/rules.ts` dropped every other event, and `scripts/register-app.mjs` registered the GitHub App only in a personal account, as a private app, which GitHub lets only its owner install. So someone whose repositories live in an organization could not use the pager, and learned it only at the end of the half hour of the set-up, when no event paged. Setting `MAINTAINER_LOGIN` to the organization was no way out: the same login decides whose issues, pull requests, comments and pictures are the maintainer's own, so the maintainer's own issues would have paged as contributions. The blueprint, whose repositories the pager looks after, works for every account and organization, so a reader who comes from there expects the same.

## Options

1. **Say the limit and keep it.** One sentence in the README and the guide, before the set-up starts.
2. **`MAINTAINER_LOGIN` may name an organization,** and the members of its teams count as the maintainer. The pager would ask GitHub for the members of a team with each event, a call more for each, with a permission for members that it doesn't need otherwise, and a member who is not the person in the chat would count as them.
3. **A variable `OWNERS`** names further owners whose repositories the pager watches beside the maintainer's own; who counts as the maintainer stays `MAINTAINER_LOGIN` alone. `scripts/register-app.mjs` takes `--org ORGANIZATION` and registers the app in that organization, as `blueprint.py app register` of the blueprint does, and the guide says which app and which control repository fit which accounts.

## Decision

Option 3. Whose repository an event comes from and who counts as the maintainer are two questions, and the pager answered both with one login: `isServed()` of `src/rules.ts` now answers the first, with `MAINTAINER_LOGIN` and `OWNERS`, and `isMaintainer()` keeps answering the second. It needs no new permission, no new call to GitHub and no new secret, and an instance without `OWNERS` behaves as before. `github-app.json` stays private, the safe default for the accounts of one person: a private app installs only on its owner, so an instance that watches the repositories of one organization registers the app there with `--org`, and one that watches those of an account and of organizations makes the app public in its settings and installs it on each. A public app holds no secret of the maintainer's, and what its other installations send ends at `where()` without a message, a record or a call to GitHub. `readSettings()` refuses an `OWNERS` with an entry that isn't a login of GitHub, as it refuses every other wrong variable, so that a typo doesn't drop the events of an organization quietly.

## Consequences

The guide decides the set-up before step 4, with a table of the accounts, the app and the control repository, and says what an organization can't do yet: the members of the organization are contributors like anyone else, a fine-grained token acts in the repositories of one owner only, so ✅ **Send** and 🛠 **Start fix** act in those of the owner that the maintainer chose for their tokens, and the workflow *Agents* of a control repository in an organization forwards nothing, since an organization sends no events itself. The roadmap names a team of an organization as an idea. `scripts/another-instance.config.ts` runs the tests with an `OWNERS` of its own, so that no test holds on to an instance without one.
