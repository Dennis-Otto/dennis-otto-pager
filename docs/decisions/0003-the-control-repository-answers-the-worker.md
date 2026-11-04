# The control repository answers the Worker, and a fix gets a token of its own

- Status: accepted
- Date: 2026-11-04

## Context

[Decision 0002](0002-buttons-of-an-allowlist-act-and-claude-only-proposes.md) lets Claude only propose, in the private control repository `Dennis-Otto/dennis-otto-pager-control`, with the maintainer's subscription. Building that repository left three questions:

- **Where its answer goes:** back to the Worker, signed, or straight to Telegram, with the token of the bot as a secret of the control repository.
- **How free text proposes an action:** the maintainer writes *merge the release of paperless-sync*, and Claude knows the repository, not the id of the pager's thing.
- **How 🛠 Start fix opens its pull request:** the Worker is the only part with tokens that write, but a fix is a change of files that Claude makes.

## Options

1. **Straight to Telegram:** the control repository holds the token of the bot and sends the answer itself. One hop less, but the token that can write to the chat lives in two places, the Worker no longer knows the state of a draft, so ✅ Send couldn't post the version that its message showed, and a failed job couldn't bring its button back.
2. **Back to the Worker:** the control repository answers at `/control`, signed with `CONTROL_SECRET`; the Worker keeps the state and shows each answer in the message of its thing.

For the pull request of a fix:

1. **Through the Worker:** the control repository sends the patch, and a button makes it a pull request with the app. The app would need *Pull requests* and *Workflows* to write, and the Worker a store for patches.
2. **In the control repository, with a token of its own:** a job after Claude's, on another machine, applies the patch and opens the pull request with a fine-grained token of the maintainer, `PAGER_FIX_TOKEN`. Claude's machine never sees it.

## Decision

Option 2 for the answer, and option 2 for the fix.

- **The answer goes to the Worker,** as one of five bodies: `draft`, `note` on a thing or for the chat, `proposal` and `failed`, each with the `usage` of the run. The token of the bot stays in Cloudflare alone.
- **A proposal names its thing as the control repository knows it:** an action, a kind of thing and its repository, with the number of a contribution. The Worker looks the thing up by its key and shows the answer with one ✅ Confirm button, whose data is that of the thing's own button, so a press runs only while the thing still offers the action. ✅ Send and ✏️ Edit can't be proposed: they stay with the message that shows the text that they post. A free text in reply to a message of the pager sends that message along, as the context that says what *it* is.
- **A job that fails says so:** `failed` brings the thing back to the state before its button, with the reason, in a new message, so that the button can run again.
- **Start fix** is the one job of the control repository that writes: a branch, one commit through the API, which GitHub signs, and a pull request that goes through the checks and the review of its repository. Pressing 🛠 Start fix is the approval of that pull request, never of a merge.

## Consequences

A leaked `CONTROL_SECRET` can show text, with buttons of the allowlist at most; it can't press one. `PAGER_FIX_TOKEN` writes to the watched repositories in the maintainer's name, but only the job after Claude's holds it, on a machine of its own, and it opens pull requests, which merge only through their checks. Without it, a fix ends with Claude's finding. Every answer shows what its run took from the weekly limit, so the maintainer sees the cost of each press.
