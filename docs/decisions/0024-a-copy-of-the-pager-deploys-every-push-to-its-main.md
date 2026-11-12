# A copy of the pager deploys every push to its main

- Status: accepted
- Date: 2026-11-12

## Context

Everyone runs the pager as an instance of their own, from a copy of this repository with their values in `wrangler.jsonc` ([decision 0018](0018-the-pager-is-repo-pager-which-everyone-runs-as-an-instance-of-their-own.md)). The guide sent a copy to Workers Builds with the deploy command of this repository, `npm run deploy`, which is `scripts/deploy-worker.sh` of the blueprint: it deploys only a commit of `main` whose subject is the release `chore: release X.Y.Z` of the version in `package.json`, and uploads every other commit as a version without traffic. The head of a copy's `main` is never such a commit: its values in `wrangler.jsonc` and the id of its namespace of Workers KV are commits of its own, the merge of a release of this repository is a merge commit, and the release workflow publishes no release in a copy, since it needs the release app of this repository. So after the first deployment by hand, no change of a copy went live, neither a fix of this repository nor a new `LANGUAGE`, and no build said so. Nor did the guide say how a copy takes a new release.

## Options

1. **A copy deploys by hand** with `npx wrangler deploy` after each push, and leaves Workers Builds out.
2. **A build variable of `scripts/deploy-worker.sh`** that lets Workers Builds deploy every commit of `main`. The script is a file of the blueprint, which every repository of the kind Cloudflare Worker shares: the change belongs to repo-blueprint, for a need of this one project.
3. **A copy sets its deploy command of Workers Builds to `npx wrangler deploy`,** which deploys every push to its `main`; without Workers Builds, it deploys by hand as in option 1.

## Decision

Option 3. A copy's `main` changes only when its maintainer changes it: with the merge of a release, which the guide brings in by its tag, never by the `main` of this repository, and with a change of its own values. Each such push is meant to go live, so deploying every one is what a copy wants, and the setting of the dashboard makes it so without a change of the blueprint's script. This repository keeps `npm run deploy`, which deploys only its releases. `docs/setup.md` tells a copy to connect Workers Builds with `npx wrangler deploy` and how to keep the copy current, and `docs/releases.md` says why `npm run deploy` doesn't fit a copy.

## Consequences

A merged release and a changed value of a copy go live a minute after the push, as the guide promises, and a build that uploads only, with `npm run deploy`, has its entry under *When a build fails*. Every merge into a copy's `main` goes live, the pull request of a bot that merges by itself too, such as one of Renovate or of the blueprint, if its maintainer turns them on there: `docs/releases.md` says to leave their automerge off in a copy or accept it. A copy has no versions without traffic: it tries a change with `npm run dev` and rolls back with `npx wrangler rollback`. The build that deploys still installs without the install scripts of the packages, with the same build command and `SKIP_DEPENDENCY_INSTALL`, and no key of Cloudflare is stored in GitHub.
