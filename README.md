# Dennis Otto Pager

[![CI](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Dennis-Otto/dennis-otto-pager/badge)](https://scorecard.dev/viewer/?uri=github.com/Dennis-Otto/dennis-otto-pager)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16429/badge)](https://www.bestpractices.dev/projects/16429)
[![OpenSSF Baseline](https://www.bestpractices.dev/projects/16429/baseline)](https://www.bestpractices.dev/projects/16429)
[![REUSE](https://api.reuse.software/badge/github.com/Dennis-Otto/dennis-otto-pager)](https://api.reuse.software/info/github.com/Dennis-Otto/dennis-otto-pager)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-website-526cfe?logo=materialformkdocs&logoColor=white)](https://dennis-otto.github.io/dennis-otto-pager/)
[![issues: triaged by issue assistant](https://img.shields.io/badge/issues-triaged%20by%20issue%20assistant-blue)](https://dennis-otto.github.io/issue-assistant/)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%99%A5-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Dennis-Otto)

A Telegram bot on a Cloudflare Worker that tells its maintainer only what needs them in their GitHub repositories, and acts on it with a button.

The documentation is on the [website](https://dennis-otto.github.io/dennis-otto-pager/). Deutsch: [README.de.md](README.de.md).

<sub>💛 If Dennis Otto Pager is useful to you, you can [support its development](https://github.com/sponsors/Dennis-Otto).</sub>

## What it does

The pager writes only when something needs its maintainer, never to say that all is well:

| What happens on GitHub | What the message offers |
| --- | --- |
| Someone other than the maintainer or a bot opens an issue or a pull request | ✍️ **Draft a reply** in the maintainer's voice, which ✅ **Send** posts exactly as shown; 🤖 **Assistant again** for an issue |
| Someone other than the maintainer or a bot comments on such an issue or pull request | The same message, edited in place to name the comment, and one notice in its topic for a few quick comments; once its reply went, ✍️ **Draft a reply** again |
| Someone other than the maintainer or a bot opens a discussion or comments on one | Its draft of a reply right away, which ✅ **Send** posts as the pager's app, in the thread of the comment that it answers; ✏️ **Edit** |
| Any workflow fails on `main`, in a push, a schedule, a bot or a start by hand, and its rerun, if one comes, fails too | One message per workflow, with the jobs that failed: each run that fails again edits it, with how often and when, and a run that passes turns it ✅; 🔁 **Rerun** of the failed jobs, ✖ **Ignore**. So the mails of GitHub Actions can go off |
| A release workflow fails, or a required check of an app other than GitHub Actions fails on `main` | 🔁 **Rerun**, which runs the failed jobs of the run again, for a short outage of GitHub; 🛠 **Start fix**, whose answer proposes 🔁 Rerun with one ✅ **Confirm** when the logs show such an outage |
| A code-scanning alert of severity high or critical appears on `main` | 🛠 **Start fix** |
| Secret scanning finds a secret, or finds it in public too | An entry of the security message of the repository, next to its code scanning, with the kind of the secret and its file, never the secret |
| Someone reports a vulnerability privately, as `SECURITY.md` asks | Its severity, its link and the days by which `SECURITY.md` promises an answer, never what it says; one reminder on the day before, while still in triage |
| A release pull request is green and up to date | 🔀 **Merge**, which publishes the release |
| A pull request of the maintainer or a bot changes how something looks, as its visual check finds | The pictures that look different, before and after, as one album in its topic, at most once per head |
| A token of yours expires in three weeks: that of Claude in the control repository, `GITHUB_USER_TOKEN` of ✅ **Send** or `PAGER_FIX_TOKEN` of 🛠 **Start fix**, or GitHub refuses `GITHUB_USER_TOKEN` | How to renew it; ✅ **Renewed** |

A message shows what its thing says, so you rarely need to open GitHub: the start of an issue, a pull request, a discussion or a comment as a folded quote, and the notes of a release, with *⚠️ Breaking changes* above them when it breaks something, so you know what 🔀 **Merge** publishes.

Every message also has ✖ **Ignore**, and all but those of a discussion and of pictures ⏰ **Later**, which brings it back after four hours. Each thing gets **one message**, which the pager edits in place as the thing changes, such as *Merging… → Merged → ✅ Published*; what fails in one repository is bundled into one message, which turns green again by itself when it is fixed. Only a new thing, a new comment on a discussion, an issue or a pull request, the answer of a draft or a fix, and the album of a newer head of a pull request, notifies. A discussion, an issue or a pull request is done by itself once you reply on GitHub or it closes, a discussion also once an answer is marked, and a text of ✏️ **Edit** stays your draft, whatever the control repository drafts later.

An event of GitHub that the pager fails to handle, such as in a short outage of Telegram, isn't lost: GitHub never delivers it again by itself, so the schedule has it delivered again, three attempts in all, and an event whose attempts all fail becomes one entry of the alarm of the control repository, *An event of GitHub fails: pull_request.opened*, linked to the recent deliveries on the app's Advanced page. Each signal changes nothing when it comes twice, and a late event that a newer one of its kind in the same repository has overtaken, such as a run that failed before a rerun passed, doesn't come again, so a second delivery can't bring back an older state.

A quiet day doesn't hide a pager that broke: once a day, the private control repository asks it for its health, and its run fails, which GitHub notifies by itself, when the schedule stopped running, Telegram refuses the bot or its webhook reports errors, GitHub refuses the app, or a token expires within a week. The day of a token of GitHub comes from the answers of its API, so no setting names it.

Any other text to the bot goes to the private control repository, which answers with Claude Code and the maintainer's own subscription; reply to a message to ask about its thing. An answer that proposes an action, such as merging the release you asked about, comes with one ✅ **Confirm** button, and nothing acts without its press. Your text gets a 👀 when it goes, a 👍 when its answer comes and a 😢 when none came, and every answer, draft and fix ends with one line on its run of Claude: the model, the effort and the tokens, such as *🧮 Opus 5.5 · high · 48,213 tokens*.

Your own agents ask through the pager too, such as an orchestrator that works through the night on your PC with `gh`: a **question** comes in a topic of its own, such as *🤔 Decision: Which release goes first?*, with its two to four options as buttons, and your press saves the answer in the private control repository, where the agent reads it with `gh`, without a secret of its own. When no option fits, a text in its topic is your answer in your own words, and an agent that no longer needs an answer takes its question back, so its buttons go. The **report of a run** comes in a topic of its own as well, such as *🧾 Run: Night run*. [How it works](docs/how-it-works.md#questions-and-reports-of-your-agents) has the commands.

With Telegram's threads turned on for the bot, **each thing gets a topic of its own**, such as *🚨 repo-blueprint needs you* or *📦 repo-blueprint 1.11.1*: its message with the buttons comes first, and its drafts, the answer of 🛠 **Start fix**, the prompt of ✏️ **Edit** and the answers to what you ask in it follow there. A question in the topic of a thing goes to the control repository with that thing, so *why?* is enough. A thing that is done gets ✅ in front of its topic, which stays as its history, and the list of topics is the overview. A topic that you open yourself, and General, start a conversation of their own, and each answer stays in the thread of the text that it answers. Without topics, everything stays in the main view, as before.

The pager speaks English or German: `LANGUAGE` in `wrangler.jsonc` chooses, `de` for this pager, and English when it is empty. Every text that it sends follows it, the buttons and `/help` included, and so do the answers of the control repository; a draft of a reply keeps the language of its issue or pull request, and what comes from GitHub, such as a title, stays as it is.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/diagrams/how-the-pager-works.dark.svg">
  <img src="docs/images/diagrams/how-the-pager-works.svg" alt="How the pager works: GitHub sends the events of the GitHub App to the Worker on Cloudflare, signed with the secret of its webhook. The rules decide what needs Dennis; everything else ends there. What counts becomes one message in Telegram, edited in place as it changes, with buttons. A button runs an action of the allowlist on GitHub, such as merging a green release. Drafts, fixes and free text go to the workflow of the private control repository, which runs Claude Code with Dennis's subscription and sends its answer back, signed, as a draft, a note or a proposal that a button has to approve.">
</picture>

[How it works](docs/how-it-works.md) lists the rules, the buttons and what the control repository sends back.

## Security and privacy

- **Only the maintainer:** the Worker serves only the chat whose id `TELEGRAM_CHAT_ID` names, and only its user; every request proves where it comes from first: the secret header of Telegram, the HMAC signature of GitHub, the signature of the control repository with its time.
- **Buttons, not commands:** a button runs one action of a fixed allowlist, and only while its thing still offers it; a merge checks again that the release is green at the head that the message showed. What an issue or a pull request says is data: it is shown, escaped, and never runs.
- **Least privilege:** the GitHub App asks for what the pager uses and nothing else, and each of its tokens is made for one repository and the permissions of one call. Two things act in the maintainer's name, with their own token: a reply on an issue or a pull request that they approved with ✅ **Send**, and the issue assistant past its rule of one comment; a reply in a discussion goes as the app.
- **No secret in the repository or the logs:** the secrets live in Cloudflare, the state in Workers KV holds no secret, and the logs name the answers of the APIs, never a token or the text of an issue.
- **Telegram is not end-to-end encrypted** for chats with a bot: Telegram can read the messages, which show titles of issues and drafts of replies. Free text and drafts run only in the **private** control repository, with Claude Code and the maintainer's own subscription, because the logs of Actions in a public repository are public.

## Set up

The pager runs on the free plans of Cloudflare and Telegram. [Set up](docs/setup.md) walks through each step in its order: the bot at @BotFather, the Worker on Cloudflare, the GitHub App from its manifest, the secrets and the webhook of Telegram. To run it on your machine, at <http://localhost:8787>, with the secrets of `.dev.vars` (see `.dev.vars.example`):

```sh
npm ci --ignore-scripts
npm run dev
```

## Development

Every change goes through a pull request whose title follows [Conventional Commits](https://www.conventionalcommits.org/), with commits that are signed off (`git commit -s`) and signed (`git commit -S`). The checks of the CI run locally with

```sh
bash scripts/check.sh
```

The tests run in workerd, the runtime of Cloudflare, against a simulated Telegram and GitHub, with every line and branch covered. [CONTRIBUTING.md](CONTRIBUTING.md) explains the set-up and the rules, [the architecture](docs/architecture.md) the modules of the Worker and the path of a request through them, and [the roadmap](docs/roadmap.md) what the pager intends to do in the next twelve months, and what it won't.

## Releases

The release bot keeps a pull request for the next release open, with the version and the changelog from the merged pull requests. Merging it publishes the release, with its SBOM and a signed provenance, and Cloudflare deploys it, as [docs/releases.md](docs/releases.md) describes; [CHANGELOG.md](CHANGELOG.md) lists every change.

## Support and security

Questions and problems: see [SUPPORT.md](SUPPORT.md). Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## License

MIT; see [LICENSE](LICENSE). Every file names its license in the machine-readable form of [REUSE](https://reuse.software).
