# Dennis Otto Pager

A Telegram bot on a Cloudflare Worker that tells its maintainer only what needs them in their GitHub repositories, and acts on it with a button.

The pager writes only when something needs its maintainer, never to say that all is well: a contribution from outside, `main` failing, a release that fails, a code-scanning alert of severity high or critical, a release pull request that is green, and the token of Claude in the control repository before it expires. Each thing gets **one message** with its buttons, which the pager edits in place as the thing changes; what fails in one repository is bundled, and only a new thing notifies.

| Button | What it does |
| --- | --- |
| 🔀 Merge | Merges a green release pull request, which publishes the release |
| ✍️ Draft a reply, ✅ Send, ✏️ Edit | A reply in the maintainer's voice from the private control repository, posted exactly as shown |
| 🤖 Assistant again | Lets the issue assistant answer an issue again, past its rule of one comment |
| 🛠 Start fix | Sends what fails to the control repository, which prepares a fix |
| ✅ Confirm | Runs the one action that an answer to your text proposes, such as a merge, while its thing still offers it |
| ⏰ Later, ✖ Ignore | Brings the thing back after four hours, or closes it |

- [How it works](how-it-works.md): the rules of what counts, the buttons, the control repository and the state.
- [Set up](setup.md): the bot, the Worker, the GitHub App, the secrets and the webhook, step by step.
- [Releases and Cloudflare](releases.md): how a release goes live.
- [Security design](security.md): the security of the repository and its releases.

Telegram doesn't encrypt chats with a bot from end to end: Telegram can read the messages, which show titles of issues and drafts of replies. Free text and drafts run only in the private control repository, with Claude Code and the maintainer's own subscription.
