# Set up

The pager needs a bot of Telegram, the Worker on Cloudflare, a GitHub App and a few secrets. These steps take about half an hour, on the free plans of Cloudflare and Telegram, and nothing of them is stored in GitHub. Do them in this order: each step needs the one before.

Run the commands in Git Bash or another shell of Unix, in a checkout of this repository, after `npm ci --ignore-scripts`. Read a secret with `read -rs`, so that it stays out of the history of the shell.

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

Create the Worker with its first deployment, as [Releases and Cloudflare](releases.md#set-up-cloudflare-once) describes, and connect the repository to Workers Builds there:

```sh
npx wrangler login
npx wrangler deploy
```

The first deployment also creates the namespace of Workers KV that holds the state of the pager and the Durable Object that runs its changes one at a time, and names the address of the Worker, such as `https://dennis-otto-pager.ACCOUNT.workers.dev`. Until step 3 is done, the Worker answers each webhook with `503`.

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
printf %s "$CONTROL_SECRET" | gh secret set PAGER_CONTROL_SECRET -R Dennis-Otto/dennis-otto-pager-control
```

**`GITHUB_USER_TOKEN`** acts in your name for two buttons only: ✅ **Send**, which posts a reply that you approved, and 🤖 **Assistant again**, which starts the issue assistant past its rule of one comment; the issue assistant asks GitHub for the role of the person who started it, and an app has none. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) for your account and your repositories, with these permissions and no others:

| Permission | Access | For |
| --- | --- | --- |
| Issues | Read and write | ✅ Send on an issue |
| Pull requests | Read and write | ✅ Send on a pull request |
| Actions | Read and write | 🤖 Assistant again |

```sh
npx wrangler secret put GITHUB_USER_TOKEN
```

Without it, the pager works as well, and those two buttons say what is missing.

## 4. The GitHub App

The app sends the events of your repositories to the Worker and merges a release and reruns the failed jobs of a run with its own, scoped tokens. `github-app.json` is its manifest, with the least permissions that the pager needs. Register it with your Worker's address:

```sh
node scripts/register-app.mjs https://dennis-otto-pager.ACCOUNT.workers.dev
```

Open the address that it prints, in the browser that is signed in to GitHub, and confirm the app. The script puts its App ID, private key and webhook secret into the secrets of the Worker, without a file, and prints the page that installs it. **Install the app** on the repositories that the pager watches **and on `Dennis-Otto/dennis-otto-pager-control`**, where it sends the drafts, the fixes and the free text.

The app is private, so only your account can install it. Its permissions:

| Permission | Access | For |
| --- | --- | --- |
| Actions | Read and write | A release workflow that fails; 🔁 Rerun, which reads a run that failed and runs its failed jobs again |
| Checks | Read | A required check that fails on `main`; a release whose checks finished |
| Code scanning alerts | Read | An alert of severity high or critical |
| Contents | Read and write | 🔀 Merge of a release; the events to the control repository |
| Issues | Read | A new issue; a `bot-failure` issue |
| Metadata | Read | Required by GitHub; the required checks of `main` |
| Pull requests | Read | A new pull request; the state of a release pull request |

An app that you registered before 🔁 **Rerun** came has *Actions: Read*: raise it to *Read and write* in the settings of the app, under *Permissions & events*, and accept the new permission for each installation, as GitHub asks you in a mail. Until then, the button says that GitHub refused it.

## 5. The webhook of Telegram

Tell Telegram where to send the updates, with the secret of step 3:

```sh
curl -s "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d url=https://dennis-otto-pager.ACCOUNT.workers.dev/telegram \
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

The private repository `Dennis-Otto/dennis-otto-pager-control` drafts the replies, starts the fixes and answers the free text, with Claude Code and `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`; its README has every step. Besides the token of Claude and `PAGER_CONTROL_SECRET` of step 3, it needs the address of the Worker, and for 🛠 **Start fix** a fine-grained token of yours for the watched repositories, with *Contents*, *Pull requests* and *Workflows* read and write, which opens the pull request of a fix:

```sh
gh variable set PAGER_URL -R Dennis-Otto/dennis-otto-pager-control --body https://dennis-otto-pager.ACCOUNT.workers.dev
gh secret set PAGER_FIX_TOKEN -R Dennis-Otto/dennis-otto-pager-control
```

Then write a question to the bot, such as *What fails on main?*: the 👀 says that it went to the control repository, and its answer comes in a minute or two and turns it into 👍. A 😢 says that no answer came to be: the job failed, or it didn't answer within an hour, and the run of the workflow in the Actions tab of the control repository says why. Until the control repository is set up, its buttons send their events, and the summary of its run shows the answer instead of the chat.

## Later on

- **The token of Claude** in the control repository expires; `CLAUDE_TOKEN_EXPIRES` in `wrangler.jsonc` names the day, and the pager reminds three weeks before. Renew it with `claude setup-token` and `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R Dennis-Otto/dennis-otto-pager-control`, then change the day in a pull request.
- **A secret that leaked:** set a new one with `npx wrangler secret put NAME`; for the app, make a new private key in its settings and set `GITHUB_APP_PRIVATE_KEY`; for the bot, `/revoke` at @BotFather, then `TELEGRAM_BOT_TOKEN` and step 5 again.
- **How long "Later" waits** is `LATER_HOURS` in `wrangler.jsonc`.
- **The language** of the pager is `LANGUAGE` in `wrangler.jsonc`: `de` for German, `en` or empty for English. It names every text that the pager sends, and the Worker passes it with each job to the control repository, whose answers follow it. A message that the pager showed already takes the new words when its thing changes. After a change, deploy the Worker again, as [Releases and Cloudflare](releases.md) describes.
