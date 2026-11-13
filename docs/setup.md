# Set up

Repo Pager is self-hosted: you run an instance of your own, with your own bot of Telegram, your own Worker on Cloudflare, your own GitHub App, a few secrets and your own private control repository. These steps take about half an hour, on the free plans of Cloudflare and Telegram, and nothing of them is stored in GitHub. Do them in this order: each step needs the one before.

Run the commands in Git Bash or another shell of Unix, in a checkout of your copy of this repository, after `npm ci --ignore-scripts`. Read a secret with `read -rs`, so that it stays out of the history of the shell.

## Why there is no shared app

There is no app of Repo Pager to install and no pager that serves several people, on purpose:

- **Your tokens and your events stay yours.** A shared app would receive the events of every user's repositories, private ones included, and hold the tokens that act in their names. Your own app sends the events of your repositories to your Worker alone, and its secrets live in your account of Cloudflare.
- **One pager serves one chat.** The Worker serves only the chat that `TELEGRAM_CHAT_ID` names and acts for one account, `MAINTAINER_LOGIN`; its state is that of one maintainer.
- **It watches the repositories of your account,** and those of an organization only when you name it in `OWNERS` and its app can be installed there, as [Repositories of an organization](#repositories-of-an-organization) describes. In the organization too, only you are the maintainer: what the other members open pages as a contribution.
- **Your subscription answers.** The drafts, the fixes and the free text run with Claude Code and your own subscription, in your own private control repository, never with the key of a shared service.

## Your copy

Make a copy of this repository: a fork, or a repository of your own. `wrangler.jsonc` is the configuration of an instance, and the values in it are those of the maintainer's own; set yours there and commit them, before step 2:

| In `wrangler.jsonc` | Your value |
| --- | --- |
| `name` | The name of your Worker, such as `repo-pager`, which its address takes |
| `kv_namespaces` | No `id`: the one there names the namespace of the maintainer's instance, and your first deployment creates your own and writes its id there |
| `MAINTAINER_LOGIN` | Your account on GitHub |
| `OWNERS` | Empty, or the organizations whose repositories the pager watches as well, separated by commas, such as `octo-org`: read [Repositories of an organization](#repositories-of-an-organization) first |
| `CONTROL_REPOSITORY` | Your private control repository, which you create below and set up in step 7, such as `octocat/repo-pager-control` |
| `LANGUAGE` | `de` for German, `en` or empty for English |
| `CLAUDE_TOKEN_EXPIRES` | The day on which your token of Claude expires, or empty |

The tests of your copy pass with your values: they take them from `wrangler.jsonc`, and `bash scripts/check.sh` runs them once more with those of another instance, so that a change of your own and an update come through a green pull request.

### Repositories of an organization

The pager watches the repositories of `MAINTAINER_LOGIN` and of each owner that `OWNERS` names; it drops the events of every other repository without a message ([decision 0025](decisions/0025-the-pager-watches-the-repositories-of-owners-beside-its-maintainer.md)). Who counts as you stays `MAINTAINER_LOGIN`, in the organization's repositories too: what you open there is yours, and what anyone else opens, a member of the organization as well, is a contribution, with its message.

Which repositories send their events is decided by the installations of the GitHub App, and a private app, as `github-app.json` registers it, can only be installed on the account that owns it. So decide before step 4:

| The pager watches | The GitHub App | The control repository |
| --- | --- | --- |
| The repositories of your account | Yours, private, as step 4 registers it | In your account |
| The repositories of one organization | The organization's, private: `node scripts/register-app.mjs "$WORKER" --org ORGANIZATION`, which needs the right to manage the organization's apps | In the organization |
| Those of your account and of organizations | Yours or an organization's, made public in its settings, under *Advanced* → *Make public*, and installed on each account | In your account |

A public app can be installed by anyone, yet it holds none of your secrets, and nothing that its other installations send reaches your chat: the Worker serves only the repositories of `MAINTAINER_LOGIN` and `OWNERS`. With a control repository in an organization, the questions and reports of your own agents don't pass: its workflow *Agents* forwards only what the owner of the repository sent, and an organization sends nothing.

A fine-grained token has one owner, your account or one organization, which may have to approve it first: `GITHUB_USER_TOKEN` of step 3 and `PAGER_FIX_TOKEN` of step 7 act only in the repositories of the owner that you choose for them. Choose the organization when the pager watches its repositories alone.

The commands below name your control repository with a variable of the shell. Create it now, private, from [the template of the control repository](https://github.com/Dennis-Otto/repo-pager-control-template), because step 3 gives it a secret and step 4 installs the app on it; step 7 sets up the rest:

```sh
CONTROL=octocat/repo-pager-control   # your account and the name of your control repository
gh repo create "$CONTROL" --private --template Dennis-Otto/repo-pager-control-template
```

The template holds the workflows of the control repository and their scripts, and its README is their guide. Your copy stays private, because the logs of its runs show issues, drafts and what Claude read. Until step 7, its daily check *Health* fails, which GitHub mails you.

## 1. The bot of Telegram

1. In Telegram, write `/newbot` to [@BotFather](https://t.me/BotFather), and give the bot a name and a user name that ends with `bot`. BotFather answers with the token of the bot: it is a secret.
2. Write any message to the new bot, so that your chat with it exists.
3. Your chat id is your user id of Telegram, a number. [@userinfobot](https://t.me/userinfobot) tells it, or the bot itself, once you wrote to it:

    ```sh
    read -rs TOKEN   # paste the token of the bot, then Enter
    curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | grep -o '"chat":{"id":[0-9]*'
    ```

    The chat id is personal: keep it out of the repository. It goes to Cloudflare as a secret in step 3.

4. Give the chat topics, one per thing: open the Mini App of @BotFather, choose the bot, then *Bot Settings* → *Threads Settings*, switch on **Threaded Mode**, and leave **Disallow users to create new threads** off, so that you can open topics of your own. The pager then opens a topic for each new thing and names it, such as *🚨 repo-blueprint needs you*, and a text in it goes to the control repository with that thing; a topic that you open is a conversation of its own. Groups stay off: the pager serves your private chat only. Without Threaded Mode, the pager writes everything into the main view, and works as it does with topics; [How it works](how-it-works.md#a-topic-per-thing) says what happens when Telegram refuses a topic.

## 2. The Worker on Cloudflare

Create the Worker with its first deployment, as [Releases and Cloudflare](releases.md#set-up-cloudflare-once) describes, and connect your copy to Workers Builds there, with the deploy command `npx wrangler deploy`, so that every push to the `main` of your copy goes live: the deploy command `npm run deploy` of this repository deploys only its own releases, and would leave every change of your copy without traffic, as [In a copy of the pager](releases.md#in-a-copy-of-the-pager) explains. Without Workers Builds, you run `npx wrangler deploy` yourself after each change. The first deployment:

```sh
npx wrangler login
npx wrangler deploy
```

The first deployment also creates the namespace of Workers KV that holds the state of the pager, and writes its id into `wrangler.jsonc`: commit it, so that every later deployment stays on that namespace. It creates the Durable Object that runs the changes one at a time as well, and names the address of the Worker, such as `https://repo-pager.ACCOUNT.workers.dev`, which the steps after take from a variable of the shell:

```sh
WORKER=https://repo-pager.ACCOUNT.workers.dev   # the address that the deployment named
```

Until step 3 is done, the Worker answers each webhook with `503`.

## 3. The secrets of the Worker

Each secret goes to Cloudflare with `npx wrangler secret put NAME`, which asks for its value:

| Secret | What it is |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | The token of the bot, from step 1 |
| `TELEGRAM_CHAT_ID` | Your chat id, from step 1: the only chat that the pager serves |
| `TELEGRAM_WEBHOOK_SECRET` | A random text that Telegram sends with every update, made below |
| `CONTROL_SECRET` | A random text with which the control repository signs its answers, made below |
| `GITHUB_USER_TOKEN` | Your fine-grained token, for the two things in your name, made below |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | The GitHub App: step 4 sets them |

The two random secrets, each kept in a variable of the shell for the steps that need it again:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
WEBHOOK_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
printf %s "$WEBHOOK_SECRET" | npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
CONTROL_SECRET=$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")
printf %s "$CONTROL_SECRET" | npx wrangler secret put CONTROL_SECRET
printf %s "$CONTROL_SECRET" | gh secret set PAGER_CONTROL_SECRET -R "$CONTROL"
```

**`GITHUB_USER_TOKEN`** acts in your name for two buttons only: ✅ **Send**, which posts a reply that you approved on an issue or a pull request, and 🤖 **Assistant again**, which starts the issue assistant past its rule of one comment; the issue assistant asks GitHub for the role of the person who started it, and an app has none. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for your account and your repositories, with these permissions and no others:

| Permission | Access | For |
| --- | --- | --- |
| Issues | Read and write | ✅ Send on an issue |
| Pull requests | Read and write | ✅ Send on a pull request |
| Actions | Read and write | 🤖 Assistant again |

```sh
npx wrangler secret put GITHUB_USER_TOKEN
```

Without it, the pager works as well, and those two buttons say what is missing. A fine-grained token expires, after 30 days unless you choose another day: the pager reads its day from GitHub once a day and reminds you three weeks before, as [Later on](#later-on) says.

## 4. The GitHub App

The app sends the events of your repositories to the Worker and merges a release and reruns the failed jobs of a run with its own, scoped tokens. `github-app.json` is its manifest, with the least permissions that the pager needs. Register it with your Worker's address:

```sh
node scripts/register-app.mjs "$WORKER"
```

For the app of an organization, add `--org ORGANIZATION`, as [Repositories of an organization](#repositories-of-an-organization) says. Open the address that it prints, in the browser that is signed in to GitHub, and confirm the app. GitHub shows its name, *Repo Pager*, in a field above the button: an app's name is unique on GitHub, so give yours one of your own there, of at most 34 characters, such as *Repo Pager of octocat*. The script puts its App ID, private key and webhook secret into the secrets of the Worker, without a file, and prints the page that installs it. GitHub hands out the key and the secret only once, so before it sends the manifest, the script asks Wrangler to list the secrets of the Worker, and stops with what to do when Wrangler isn't signed in or the Worker isn't deployed yet. Should Wrangler still fail to store one, the script names the secrets that are stored and those that are missing, and the page of the app's settings where you make a new private key and set a new webhook secret, or where you delete the app to run the script again. **Install the app** on the repositories that the pager watches **and on your control repository**, where it sends the drafts, the fixes and the free text.

The app is private, so only the account that owns it can install it: yours, or the organization of `--org`. To install it on more than one account, make it public, as [Repositories of an organization](#repositories-of-an-organization) describes. Its permissions:

| Permission | Access | For |
| --- | --- | --- |
| Actions | Read and write | A workflow that fails on `main`, and the jobs that failed in it; 🔁 Rerun, which reads a run that failed and runs its failed jobs again; the pictures of a visual check |
| Checks | Read | A required check of another app than GitHub Actions that fails on `main`; a release whose checks finished |
| Code scanning alerts | Read | An alert of severity high or critical |
| Contents | Read and write | 🔀 Merge of a release; the events to the control repository; whether a release is still a draft after a failed release, which GitHub lists only to a token that may write the contents |
| Discussions | Read and write | A new discussion or a comment on one; ✅ Send of a reply in a discussion, as the app |
| Issues | Read | A new issue, a comment on one or on a pull request, a reopen, and its end; a `bot-failure` issue |
| Metadata | Read | Required by GitHub; the required checks of `main` |
| Pull requests | Read | A new pull request, its reviews, the comments in its code, its new commits, a reopen and ready for review; the state of a release pull request; who opened a pull request whose pictures changed, and its head |
| Repository security advisories | Read | A private vulnerability report and its advisory published; on day 6, whether a report still waits in triage, the one field that the pager reads of it |
| Secret scanning alerts | Read | An alert of secret scanning and the file of its secret, never the secret |

An app that you registered before 🔁 **Rerun** came has *Actions: Read*: raise it to *Read and write* in the settings of the app, under *Permissions & events*, and accept the new permission for each installation, as GitHub asks you in a mail. Until then, the button says that GitHub refused it.

An app that you registered before discussions came has neither *Discussions* nor its events: give it *Discussions: Read and write* in the settings of the app, under *Permissions & events*, subscribe it to the events *Discussion* and *Discussion comment*, and accept the new permission for each installation. Until then, no discussion reaches the pager.

An app that you registered before the comments on issues and pull requests came lacks their event: subscribe it to *Issue comment* in the settings of the app, under *Permissions & events*. Its permissions *Issues* and *Pull requests* cover it, so no installation needs to accept anything. Until then, no comment on an issue or a pull request reaches the pager, and a thing still closes with its issue or pull request.

An app that you registered before the reviews came lacks their events: subscribe it to *Pull request review* and *Pull request review comment* in the settings of the app, under *Permissions & events*. Its permission *Pull requests* covers them, so no installation needs to accept anything. Until then, neither a review nor a reply in the thread of a review reaches the pager, while new commits, a reopen and ready for review come with the events that the app has.

An app that you registered before the vulnerability reports and the secrets came lacks both: give it *Repository security advisories: Read* and *Secret scanning alerts: Read* in the settings of the app, under *Permissions & events*, subscribe it to the events *Repository advisory* and *Secret scanning alert*, and accept the new permissions for each installation. Until then, GitHub tells of a report and a secret only by mail, as before.

## 5. The webhook of Telegram

Tell Telegram where to send the updates, with the secret of step 3:

```sh
curl -s "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d url="$WORKER/telegram" \
  -d secret_token="$WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","callback_query"]' \
  -d max_connections=1
curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
```

`max_connections=1` makes Telegram send one update at a time, so that a button pressed twice acts once. `getWebhookInfo` names the address and, after a failed delivery, the error.

## 6. Try it

- Write `/help` to the bot: it answers with what it does.
- In the settings of the GitHub App, under *Advanced*, the first delivery is a `ping`, which the Worker answers with `pong`.
- Open an issue in a watched repository from another account: the message comes with its buttons.

## 7. The control repository

Your private control repository, which `CONTROL_REPOSITORY` names, drafts the replies, starts the fixes and answers the free text, with Claude Code and your own subscription. You made it from the template at the start, so its workflows are there, and [the README of the template](https://github.com/Dennis-Otto/repo-pager-control-template#readme) describes each of its jobs, secrets and variables; [How it works](how-it-works.md#the-control-repository) has the contract between the two: the events that the pager sends it and the signed answers that the pager takes. Besides `PAGER_CONTROL_SECRET` of step 3, it needs the token of your Claude subscription from `claude setup-token`, the address of the Worker, the name of your app in its address, `github.com/apps/NAME`, which is the only bot whose events start Claude, and for 🛠 **Start fix** a fine-grained token of yours for the watched repositories and for the control repository itself, with *Contents*, *Pull requests* and *Workflows* read and write, which opens the pull request of a fix and that of a change of the template:

```sh
claude setup-token                                   # prints the token of your subscription
gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$CONTROL"  # paste it
gh variable set PAGER_URL -R "$CONTROL" --body "$WORKER"
gh variable set PAGER_APP -R "$CONTROL" --body repo-pager-of-octocat   # the name of your app in its address
gh secret set PAGER_FIX_TOKEN -R "$CONTROL"
```

Then write how you write into `pager/voice.md` of your control repository: a draft of a reply in your name follows it, and the template's copy is only an example. For a pager in German, `gh variable set PAGER_LANGUAGE -R "$CONTROL" --body de` lets the report of a change of the template speak German too. Once a week, the workflow *Template* of your control repository brings what changed in the template as a pull request, and the pager tells you; your README and your voice stay as they are ([decision 0019](decisions/0019-the-control-repository-comes-from-a-public-template-which-every-copy-follows.md)).

Then write a question to the bot, such as *What fails on main?*: the 👀 says that it went to the control repository, and its answer comes in a minute or two and turns it into 👍. A 😢 says that no answer came to be: the job failed, or it didn't answer within an hour, and the run of the workflow in the Actions tab of the control repository says why. Until the control repository is set up, its buttons send their events, and the summary of its run shows the answer instead of the chat.

## Later on

- **Your tokens expire,** and the pager reminds you three weeks before each, in a topic of its own, with how to renew it, and once more on the day it expires; ✅ **Renewed** closes the reminder:
  - **The token of Claude** in the control repository: `CLAUDE_TOKEN_EXPIRES` in `wrangler.jsonc` names the day. Renew it with `claude setup-token` and `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R "$CONTROL"`, then change the day in a pull request.
  - **`GITHUB_USER_TOKEN`** of the Worker: GitHub names its day in the answers of its API, which the pager reads once a day. Regenerate it on the page of your [fine-grained tokens](https://github.com/settings/personal-access-tokens), with a new day, and set it with `npx wrangler secret put GITHUB_USER_TOKEN`; the pager asks GitHub about a new token at once. When GitHub refuses the token, because it expired or was revoked, the reminder says so, and ✅ **Send** and 🤖 **Assistant again** too.
  - **`PAGER_FIX_TOKEN`** of the control repository: its daily check *Health* reads the day from GitHub and sends it along. Regenerate it the same way and set it with `gh secret set PAGER_FIX_TOKEN -R "$CONTROL"`.
- **The health of the pager:** the workflow *Health* of the control repository asks the pager once a day how it is, as [How it works](how-it-works.md#when-the-pager-breaks) describes, which takes about a minute of its Actions minutes. Its run fails when the schedule stopped, Telegram refuses the bot or its webhook reported an error in the last day, GitHub refuses the app, or a token expires within a week; GitHub then notifies you of the failed run by itself, also when Telegram or the Worker is what broke. Start it by hand in the Actions tab to check the pager after a change.
- **A secret that leaked:** set a new one with `npx wrangler secret put NAME`; for the app, make a new private key in its settings and set `GITHUB_APP_PRIVATE_KEY`; for the bot, `/revoke` at @BotFather, then `TELEGRAM_BOT_TOKEN` and step 5 again.
- **How long "Later" waits** is `LATER_HOURS` in `wrangler.jsonc`. A change of `wrangler.jsonc` goes live once it is on the `main` of your copy, as [Keep your copy current](#keep-your-copy-current) says.
- **The mails of GitHub Actions** can go off once the pager pages for every [workflow that fails on `main`](how-it-works.md#a-workflow-that-fails-on-main): in the settings of your account on GitHub, under *Notifications*, *System*, *Actions*, turn off *Email*, but keep *Web and Mobile* on and look at your notifications on github.com or in the GitHub app: the pager can't page a failure of itself, so the failed run of *Health* of the control repository reaches you only that way once *Email* is off. If you would rather keep that one by mail, leave *Email* on and filter your mail instead: keep the mails of Actions of your control repository and drop the others. A run of a pull request still shows on the pull request.
- **The language** of the pager is `LANGUAGE` in `wrangler.jsonc`: `de` for German, `en` or empty for English. It names every text that the pager sends, and the Worker passes it with each job to the control repository, whose answers follow it. In any language but English, the control repository also translates the notes of each release, with a job for `pager-translate`, once the template of the control repository brings it; until your copy has it, the headings of the notes come in your language and their items stay English ([how it works](how-it-works.md#the-notes-of-a-release-in-your-language)). A message that the pager showed already takes the new words when its thing changes. A change goes live once it is on the `main` of your copy, as [Keep your copy current](#keep-your-copy-current) says.

## Keep your copy current

Each release of Repo Pager is a tag `vX.Y.Z` of this repository, with its notes on the [page of the releases](https://github.com/Dennis-Otto/repo-pager/releases); *Watch*, *Custom* and *Releases* on that page of GitHub tell you of each. Bring a release into the `main` of your copy by its tag, in a checkout of your copy:

```sh
git remote add upstream https://github.com/Dennis-Otto/repo-pager.git   # once
git switch main && git pull
git fetch upstream --tags
git merge --no-edit vX.Y.Z   # the tag of the release
```

- **The tag, never `main`:** the `main` of this repository holds changes that no release has yet. *Sync fork* on GitHub merges that `main`, so bring the releases of a fork in by their tags as well.
- **Your `wrangler.jsonc` stays yours:** where a release changes `wrangler.jsonc` next to one of your values, the merge stops with a conflict there. Keep your values of [the table above](#your-copy), the name of your Worker, the id of your namespace and your settings, and take everything else that the release changes, such as a new setting or binding; then `git add wrangler.jsonc` and `git commit --no-edit`.
- **Check it:** `npm ci --ignore-scripts && npm test` runs the tests with your values.
- **What the release asks of you:** its notes name each step beyond the code, such as a new permission or event of the GitHub App, which you accept in the settings of your app, or a new secret of the Worker.

Then `git push`: the push to `main` goes live by itself when Workers Builds deploys your copy with `npx wrangler deploy`; without it, run `npx wrangler deploy` now, as [Releases and Cloudflare](releases.md#in-a-copy-of-the-pager) describes. A change of your own values in `wrangler.jsonc`, such as `LANGUAGE` or `LATER_HOURS`, goes live the same way, and `npx wrangler rollback` takes back a version that misbehaves. Your control repository follows its template by itself, with the pull requests of its workflow *Template* (step 7).
