# Releases and Cloudflare

**Repo Pager** runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/). Cloudflare builds it from this repository with [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), and only a release goes live: no key of Cloudflare is stored in GitHub. A copy of the pager, which runs an instance of its own, goes live with every push to its `main` instead, as [In a copy of the pager](#in-a-copy-of-the-pager) describes.

## How a change goes live

| What happens on `main` | What Cloudflare does |
| --- | --- |
| A pull request merges | Workers Builds builds the commit and `npm run deploy` uploads it as a version without traffic, which the dashboard lists with its commit |
| The release pull request `chore: release X.Y.Z` merges | Workers Builds builds the commit and `npm run deploy` deploys it: version X.Y.Z goes live, tagged `vX.Y.Z` |
| A push to `main` of a copy of the pager, such as the merge of a release of this repository or a change of its `wrangler.jsonc` | Workers Builds builds the commit and its deploy command `npx wrangler deploy` deploys it: it goes live |

A prerelease, such as `chore: release 2.0.0-beta.1`, becomes a version without traffic as well, tagged `v2.0.0-beta.1`: try it, or roll it out gradually under *Deployments*, before the release deploys.

The release workflow tags the same commit as `vX.Y.Z` and publishes the release on GitHub, with its changelog, its SBOMs and the signed provenance of its build, as [SECURITY.md](https://github.com/Dennis-Otto/repo-pager/blob/main/SECURITY.md#verify-a-release) shows. So the Worker that runs is always the code of the latest release, and the dashboard of Cloudflare names its version by the tag of that release. `scripts/deploy-worker.sh`, which `npm run deploy` runs, decides between the two: it deploys only a commit of `main` whose subject names the release of the version in `package.json`, and uploads every other one.

## Set up Cloudflare once

You need an account of Cloudflare; the free plan runs a Worker. These steps take about ten minutes, and nothing of them is stored in GitHub.

1. **Create the Worker** with its first deployment, from your machine, which signs in to Cloudflare in the browser and keeps the sign-in there:

    ```sh
    npm ci --ignore-scripts
    npx wrangler login
    npx wrangler deploy
    ```

    The Worker gets the name of `wrangler.jsonc`, which Workers Builds needs as well: the one that you chose for your copy, as [Set up](setup.md) describes, such as `repo-pager`. The maintainer's own Worker keeps the name it was created with, `dennis-otto-pager`, since its secrets and its state belong to it.
2. **Connect the repository:** in the dashboard of Cloudflare, open *Workers & Pages*, your Worker, *Settings* and *Builds*, and choose *Connect*. Install the app *Cloudflare Workers and Pages* on GitHub for this repository only, and choose your copy of the repository.
3. **Set the build** as follows:

    | Setting | Value |
    | --- | --- |
    | Branch | `main` |
    | Build command | `npm ci --ignore-scripts` |
    | Build variable, under *Variables and secrets* | `SKIP_DEPENDENCY_INSTALL` = `1`: otherwise Cloudflare installs the dependencies itself first, with the install scripts of every package, in the one build that can deploy; the build command installs them without |
    | Deploy command | `npm run deploy`; in a copy of the pager, `npx wrangler deploy`, as [In a copy of the pager](#in-a-copy-of-the-pager) says why |
    | Builds for non-production branches | off: the checks of each pull request run in GitHub |
    | Root directory | empty, the root of the repository |

4. **Put each secret of the Worker into Cloudflare,** never into the repository:

    ```sh
    npx wrangler secret put NAME
    ```

    The dashboard has them under *Settings* and *Variables and Secrets* as well. For `npm run dev` on your machine, write them into `.dev.vars`, which git ignores.

From then on, every merge reaches Cloudflare by itself, and the dashboard shows the log of each build: here, each release goes live, and in a copy, each push to its `main`.

## In a copy of the pager

Everyone runs the pager as an instance of their own ([decision 0018](decisions/0018-the-pager-is-repo-pager-which-everyone-runs-as-an-instance-of-their-own.md)), from a copy of this repository: a fork, or a repository of your own, with your values in `wrangler.jsonc`, as *Your copy* of [Set up](setup.md) describes. `npm run deploy` doesn't deploy a copy: it deploys only a commit whose subject is a release, `chore: release X.Y.Z`, and the head of a copy's `main` never is one. Your values in `wrangler.jsonc` are a commit of your own, and so is the merge of each release that you bring in, while the release workflow publishes no release in a copy, since it needs the release app of this repository. With `npm run deploy`, every build of a copy would only upload a version without traffic, without an error.

So a copy deploys every push to its `main`, which changes only when you change it ([decision 0024](decisions/0024-a-copy-of-the-pager-deploys-every-push-to-its-main.md)):

- **With Workers Builds:** connect your copy as in [Set up Cloudflare once](#set-up-cloudflare-once), with the deploy command `npx wrangler deploy` in step 3, and every other setting as there. Then the merge of a release and a change of `wrangler.jsonc`, such as a new `LANGUAGE` or `LATER_HOURS`, go live by themselves, a minute after the push.
- **By hand:** without Workers Builds, run `npx wrangler deploy` in a checkout of your `main` after each such push, signed in with `npx wrangler login`.

Either way, the Worker deploys what your `main` has, with your `wrangler.jsonc`, and every merge into it goes live, the pull request of a bot that merges by itself too, such as one of Renovate or of the blueprint, if you turn them on in your copy: leave their automerge off there, or accept that what they merge goes live. Bring in each release by its tag, never the `main` of this repository, which holds changes that no release has yet: *Keep your copy current* of [Set up](setup.md) shows how. A copy uploads no versions without traffic: try a change with `npm run dev` before you push it, and roll back as below.

## Roll back

A release that misbehaves goes back to the version before it in the dashboard, under *Deployments*, or with:

```sh
npx wrangler rollback
```

Then fix the cause in a pull request; the next release deploys it.

## When a build fails

The pager notices a release that didn't go live itself: once the event of a release of its own repository came, its schedule compares the release with the version that runs, and after 30 minutes without it, it says so in a message of its own, once. `/status` shows the version that runs, and the health that the control repository asks for each day names it with the release that it waits for ([The health of the pager](how-it-works.md#the-health-of-the-pager)). The log of the build in the dashboard of Cloudflare says why; the causes are these:

- **The name doesn't match:** Workers Builds builds only the Worker whose name `wrangler.jsonc` names. Change the name in `wrangler.jsonc` back to that of the Worker: a Worker of a new name would be a new Worker, without the secrets and the state of the old one.
- **No build after the repository was renamed or moved:** the dashboard lists no build of the merges since. Open *Workers & Pages*, the Worker, *Settings* and *Builds*, disconnect the repository and connect it again under its new name, with the settings of step 3; the version that runs keeps serving meanwhile.
- **Another Node:** the build takes the Node of `.nvmrc`; if its log shows another one, set the build variable `NODE_VERSION` to the version of `.nvmrc` under *Settings* and *Builds*.
- **A release that didn't deploy:** the log of its build says why `npm run deploy` only uploaded it, such as a `package.json` with another version than the title of the release, or a branch of another name than `main`. *Retry build* builds the same commit again, once a setting of Cloudflare was the cause; `npx wrangler deploy` from a checkout of its tag deploys it by hand. In a copy of the pager, run `npx wrangler deploy` from a checkout of its own `main`, never from a tag of this repository, whose `wrangler.jsonc` names the maintainer's Worker and his namespace of Workers KV.
- **A change of a copy that didn't go live:** the log of its build shows `npm run deploy`, which uploads a version without traffic in a copy: set the deploy command to `npx wrangler deploy`, as [In a copy of the pager](#in-a-copy-of-the-pager) says, and choose *Retry build*.
- **A warning about `SKIP_DEPENDENCY_INSTALL`:** the build variable of step 3 is missing, and Cloudflare's own install ran the install scripts of the packages. Set it to `1`.
- **`npm run deploy` on your machine** refuses: it runs only in Workers Builds. `npx wrangler deploy` deploys by hand, past the release, for an emergency.
