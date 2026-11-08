# The pager is Repo Pager, which everyone runs as an instance of their own

- Status: accepted
- Date: 2026-11-08

## Context

The pager was called Dennis Otto Pager from its first release: it was its maintainer's pager for his repositories. Little in it was his alone, though. Its rules, buttons and texts speak of *the maintainer*, and `wrangler.jsonc` names the account, the control repository and the language, while the chat and every token are secrets in Cloudflare. Anyone could run it for their own repositories, but the name said that it belonged to one person, the set-up walked through `Dennis-Otto/dennis-otto-pager-control` and an address of his Worker, and the diagrams named him as the one who presses the buttons.

On 2026-11-08 the maintainer asked whether the pager should have a generic name, since anyone can use it, and chose **Repo Pager**. The repositories became `Dennis-Otto/repo-pager` and `Dennis-Otto/repo-pager-control`, and GitHub leads the old names to the new ones.

## Options

1. **Keep the name.** Others copy the pager as it is, and read past a name and a guide that speak of someone else.
2. **A generic product with one shared app.** The maintainer runs one pager for everyone, whose GitHub App anyone installs.
3. **A generic product that everyone runs as their own instance.** Each user makes their own bot, Worker, GitHub App and private control repository, with a guide that says what to set.

## Decision

Option 3. The product is Repo Pager everywhere: in the READMEs, on the website at <https://dennis-otto.github.io/repo-pager/>, in the answers of the blueprint (`project_name` and `project_slug`, rendered with `copier update`, so that the blueprint's files follow), in `package.json`, in the User-Agent of the Worker and of `scripts/register-app.mjs`, in the social preview and in the manifest of the GitHub App. The manifest names the app *Repo Pager*, which each user changes on the page of GitHub where they confirm it, since the name of an app is unique on GitHub. The diagrams speak of the maintainer, and the guide of each command's own control repository and Worker, from variables of the shell.

There is no shared app, for three reasons, which [Set up](../setup.md) gives its readers:

- **Tokens and events stay with their owner.** A shared app would receive the events of every user's repositories, private ones included, and would hold the tokens that act in their names. An app of one's own sends them to one's own Worker only.
- **One pager serves one chat.** The Worker serves the one chat of `TELEGRAM_CHAT_ID` and acts for the one account of `MAINTAINER_LOGIN`, and its state in Workers KV and in its Durable Object is that of one maintainer. A shared pager would have to keep its users apart in every rule, button and record.
- **The user's own subscription answers.** Drafts, fixes and free text run with Claude Code and the user's own subscription in a private repository; a shared service would need a key of the API and run the text of others with it, which the [roadmap](../roadmap.md) rules out.

`wrangler.jsonc` stays the configuration of the maintainer's own instance, and its comments and the section *Your copy* of the guide say what a user sets in their copy. Its Worker keeps the name `dennis-otto-pager`: its secrets and the state of its Durable Object belong to it, and a Worker of a new name would be a new Worker, which Workers Builds would deploy without them. `CONTROL_REPOSITORY` names the renamed control repository. The decision records before this one keep the old name where they tell their history.

## Consequences

- Anyone can set up a pager from the guide, which starts with their own copy of the repository and explains why there is no app to install.
- A pager that runs needs no change: its Worker keeps its name, its address, its secrets and its state, its GitHub App keeps its name, and the old addresses of the repositories lead to the new ones. So the rename is a feature, not a breaking change.
- The release pull request moves to a branch of the new name, since release-please names it after the package; an open one of the old name is closed by hand.
- The workflow of the maintainer's own control repository stays private. Another user answers the pager with a workflow of their own, by the contract that [How it works](../how-it-works.md) describes. [Decision 0019](0019-the-control-repository-comes-from-a-public-template-which-every-copy-follows.md) replaced this with a public template of the control repository, of which every control repository is a private copy.
- Whether the connection of Workers Builds follows a renamed repository, Cloudflare's documentation doesn't say. The first merge after the rename shows it in the list of versions of the Worker, and [Releases and Cloudflare](../releases.md#when-a-build-fails) says how to connect the repository again if not.
- The blueprint gives the scheduled workflows a time of their own for each repository of its fleet; its release that names `repo-pager` in the fleet brings back the time that the old name had.
