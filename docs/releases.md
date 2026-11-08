# Releases and Cloudflare

**Repo Pager** runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/). Cloudflare builds it from this repository with [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), and only a release goes live: no key of Cloudflare is stored in GitHub.

## How a change goes live

| What happens on `main` | What Cloudflare does |
| --- | --- |
| A pull request merges | Workers Builds builds the commit and `npm run deploy` uploads it as a version without traffic, which the dashboard lists with its commit |
| The release pull request `chore: release X.Y.Z` merges | Workers Builds builds the commit and `npm run deploy` deploys it: version X.Y.Z goes live, tagged `vX.Y.Z` |

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
    | Deploy command | `npm run deploy` |
    | Builds for non-production branches | off: the checks of each pull request run in GitHub |
    | Root directory | empty, the root of the repository |

4. **Put each secret of the Worker into Cloudflare,** never into the repository:

    ```sh
    npx wrangler secret put NAME
    ```

    The dashboard has them under *Settings* and *Variables and Secrets* as well. For `npm run dev` on your machine, write them into `.dev.vars`, which git ignores.

From then on, every merge reaches Cloudflare by itself, and the dashboard shows the log of each build.

## Roll back

A release that misbehaves goes back to the version before it in the dashboard, under *Deployments*, or with:

```sh
npx wrangler rollback
```

Then fix the cause in a pull request; the next release deploys it.

## When a build fails

- **The name doesn't match:** Workers Builds builds only the Worker whose name `wrangler.jsonc` names. Change the name in `wrangler.jsonc` back to that of the Worker: a Worker of a new name would be a new Worker, without the secrets and the state of the old one.
- **No build after the repository was renamed or moved:** the dashboard lists no build of the merges since. Open *Workers & Pages*, the Worker, *Settings* and *Builds*, disconnect the repository and connect it again under its new name, with the settings of step 3; the version that runs keeps serving meanwhile.
- **Another Node:** the build takes the Node of `.nvmrc`; if its log shows another one, set the build variable `NODE_VERSION` to the version of `.nvmrc` under *Settings* and *Builds*.
- **A release that didn't deploy:** the log of its build says why `npm run deploy` only uploaded it, such as a `package.json` with another version than the title of the release, or a branch of another name than `main`. *Retry build* builds the same commit again, once a setting of Cloudflare was the cause; `npx wrangler deploy` from a checkout of its tag deploys it by hand.
- **A warning about `SKIP_DEPENDENCY_INSTALL`:** the build variable of step 3 is missing, and Cloudflare's own install ran the install scripts of the packages. Set it to `1`.
- **`npm run deploy` on your machine** refuses: it runs only in Workers Builds. `npx wrangler deploy` deploys by hand, past the release, for an emergency.
