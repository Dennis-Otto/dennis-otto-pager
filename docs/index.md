# Repo Pager

A Telegram bot on a Cloudflare Worker that tells its maintainer only what needs them in their GitHub repositories, and acts on it with a button.

The pager writes only when something needs its maintainer, never to say that all is well: a contribution from outside and each comment of someone else on it, a discussion or a comment on one from someone else, `main` failing, a release that fails, a code-scanning alert of severity high or critical, a secret that secret scanning found, a private vulnerability report without a word of what it says, a release pull request that is green, the pictures of a pull request of the maintainer or a bot that changes how something looks, before and after, and the token of Claude in the control repository before it expires. Each thing gets **one message** with its buttons, in a topic of its own once Threaded Mode is on for the bot, which the pager edits in place as the thing changes; what fails in one repository is bundled, and only a new thing, a new comment on a discussion, an issue or a pull request, the answer of a draft or a fix, and the album of a newer head of a pull request, notifies. A question in the topic of a thing goes to the control repository with that thing, and a done thing gets ✅ in front of its topic: a discussion, an issue or a pull request is done by itself once the maintainer replies on GitHub or it closes, a discussion also once an answer is marked, and a text of ✏️ Edit stays the maintainer's own draft.

| Button | What it does |
| --- | --- |
| 🔀 Merge | Merges a green release pull request, which publishes the release |
| ✍️ Draft a reply, ✅ Send, ✏️ Edit | A reply in the maintainer's voice from the private control repository, posted exactly as shown; in a discussion, its draft comes by itself and goes as the app |
| 🤖 Assistant again | Lets the issue assistant answer an issue again, past its rule of one comment |
| 🔁 Rerun | Runs the failed jobs of a run that failed on `main` again, without a run of Claude |
| 🛠 Start fix | Sends what fails to the control repository, which prepares a fix |
| ✅ Confirm | Runs the one action that an answer of the control repository proposes, such as a merge you asked about, or 🔁 Rerun after a fix found an outage of GitHub, while its thing still offers it |
| ⏰ Later, ✖ Ignore | Brings the thing back after four hours, or closes it |

The pager speaks English or German, as `LANGUAGE` in `wrangler.jsonc` says: `de` for the maintainer's own pager, English when it is empty. The buttons, `/help` and every other text that it sends follow it, and so do the answers of the control repository.

- [How it works](how-it-works.md): the rules of what counts, the buttons, the control repository, the questions and reports of your agents, and the state.
- [Set up](setup.md): your own instance, since there is no shared app, with your copy, the bot, the Worker, the GitHub App, the secrets and the webhook, step by step.
- [Releases and Cloudflare](releases.md): how a release goes live.
- [Architecture](architecture.md): the modules of the Worker, the path of a request through them and the decisions behind them.
- [Security design](security.md): the security of the repository and its releases.
- [Roadmap](roadmap.md): what the pager intends to do in the next twelve months, and what it won't.

Telegram doesn't encrypt chats with a bot from end to end: Telegram can read the messages, which show titles of issues and drafts of replies. Free text and drafts run only in the private control repository, with Claude Code and the maintainer's own subscription.
