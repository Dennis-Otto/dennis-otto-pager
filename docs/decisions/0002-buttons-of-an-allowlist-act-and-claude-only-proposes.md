# Buttons of an allowlist act, and Claude only proposes

- Status: accepted
- Date: 2026-11-04

## Context

The maintainer wants to hear about his repositories only when something needs him, and to act on it from his phone: merge a green release, start a fix, answer a contribution from outside in his own voice, let the issue assistant answer again. Free text should be understood, and Claude should help, but only through his own subscription of Claude, never an API key, which costs more. Three things limit the design:

- The logs of Actions in a public repository are public, and so are what a workflow there reads and writes. The code of the pager is public, so that it gets the rulesets and the code scanning of the blueprint on GitHub Free.
- Whatever an issue or a pull request from outside says can try to steer an AI that reads it.
- Telegram doesn't encrypt chats with a bot from end to end, and a webhook is an address that anyone can call.

## Options

1. **A bot with commands:** the maintainer types commands such as `/merge repo 30`, and the Worker runs them. Typing on a phone is slow and error-prone, and every command is a write that nothing confirms.
2. **Claude decides and acts:** free text goes to a workflow with Claude Code and a token that can write, and Claude merges, comments and dispatches as it understands the text. It is the most flexible, but a contribution from outside that Claude reads could make it write.
3. **Buttons of an allowlist act, and Claude only proposes:** the Worker shows each thing with the buttons that its kind offers in its state, and runs only those actions, with the checks of each, such as the head of a release. Claude runs in a private control repository with the subscription token of the maintainer; it reads the issues as data and sends back drafts and notes, signed, which a button has to approve before anything is written.

## Decision

Option 3.

- **The Worker** is the only part with tokens that write: the GitHub App, whose tokens are scoped to one repository and the permissions of one call, and a fine-grained token of the maintainer for the two things in his name, ✅ **Send** and 🤖 **Assistant again**.
- **The allowlist** lives in `src/buttons.ts`, the rules of what counts in `src/rules.ts`; each is one place with its tests.
- **The control repository** `Dennis-Otto/dennis-otto-pager-control` is private and holds `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`. The pager sends it events with references, never the text of an issue, and it answers at `/control` with an HMAC over its time and body under `CONTROL_SECRET`.
- **Every request proves its origin** before anything runs: the secret header of Telegram's `setWebhook`, the signature of GitHub's webhook, the signature of the control repository; and only the chat of `TELEGRAM_CHAT_ID` is served.
- **Few messages:** one message per thing, edited in place; bundles per repository; a new message only for a new thing.

## Consequences

Nothing that an issue says can make the pager write: Claude can only propose, and a proposal is text until the maintainer presses a button that the allowlist offers. A new kind of action takes a change of the allowlist, with its tests, rather than a prompt. Claude's work counts against the same weekly limit of the maintainer's subscription as his other runs, and the pager reminds him three weeks before its token expires. Telegram can read what the chat shows, so the messages carry titles and drafts, never secrets.
