# Dennis Otto Pager

[![CI](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Dennis-Otto/dennis-otto-pager/badge)](https://scorecard.dev/viewer/?uri=github.com/Dennis-Otto/dennis-otto-pager)
[![REUSE](https://api.reuse.software/badge/github.com/Dennis-Otto/dennis-otto-pager)](https://api.reuse.software/info/github.com/Dennis-Otto/dennis-otto-pager)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-website-526cfe?logo=materialformkdocs&logoColor=white)](https://dennis-otto.github.io/dennis-otto-pager/)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%99%A5-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Dennis-Otto)

A Telegram bot on a Cloudflare Worker that tells its maintainer only what needs them in their GitHub repositories, and acts on it with a button.

The documentation is on the [website](https://dennis-otto.github.io/dennis-otto-pager/). Deutsch: [README.de.md](README.de.md).

<sub>💛 If Dennis Otto Pager is useful to you, you can [support its development](https://github.com/sponsors/Dennis-Otto).</sub>

## What it does

The pager writes only when something needs its maintainer, never to say that all is well:

| What happens on GitHub | What the message offers |
| --- | --- |
| Someone other than the maintainer or a bot opens an issue or a pull request | ✍️ **Draft a reply** in the maintainer's voice, which ✅ **Send** posts exactly as shown; 🤖 **Assistant again** for an issue |
| A required check fails on `main`, a release workflow fails, or the bot-health bot opens a `bot-failure` issue | 🛠 **Start fix** |
| A code-scanning alert of severity high or critical appears on `main` | 🛠 **Start fix** |
| A release pull request is green and up to date | 🔀 **Merge**, which publishes the release |
| The token of Claude in the control repository expires in three weeks | ✅ **Renewed** |

Every message also has ⏰ **Later**, which brings it back after four hours, and ✖ **Ignore**. Each thing gets **one message**, which the pager edits in place as the thing changes, such as *Merging… → Merged → ✅ Published*; what fails in one repository is bundled into one message, which turns green again by itself when it is fixed. Only a new thing notifies.

Any other text to the bot goes to the private control repository, which answers with Claude Code and the maintainer's own subscription; reply to a message to ask about its thing. An answer that proposes an action, such as merging the release you asked about, comes with one ✅ **Confirm** button, and nothing acts without its press. Your text gets a 👀 when it goes, a 👍 when its answer comes and a 😢 when none came, and every answer, draft and fix ends with one line on its run of Claude: the model, the effort and the tokens, such as *🧮 Opus 5.5 · high · 48,213 tokens*.

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
- **Least privilege:** the GitHub App asks for what the pager uses and nothing else, and each of its tokens is made for one repository and the permissions of one call. Two things act in the maintainer's name, with their own token: a reply that they approved with ✅ **Send**, and the issue assistant past its rule of one comment.
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

The tests run in workerd, the runtime of Cloudflare, against a simulated Telegram and GitHub, with every line and branch covered. [CONTRIBUTING.md](CONTRIBUTING.md) explains the set-up and the rules.

## Releases

The release bot keeps a pull request for the next release open, with the version and the changelog from the merged pull requests. Merging it publishes the release, with its SBOM and a signed provenance, and Cloudflare deploys it, as [docs/releases.md](docs/releases.md) describes; [CHANGELOG.md](CHANGELOG.md) lists every change.

## Support and security

Questions and problems: see [SUPPORT.md](SUPPORT.md). Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## License

MIT; see [LICENSE](LICENSE). Every file names its license in the machine-readable form of [REUSE](https://reuse.software).
