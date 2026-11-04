# Changelog

All notable changes, by release. Each pull request that changes something for
users describes it in a file of its own in `changelog.d/`, or under Unreleased. The
release bot makes that text the section of the next release, or lists the pull
requests when there is none.

## Unreleased

## 0.1.0 (2026-11-04)

### Features

- Write to the pager in your own words: the private control repository answers with Claude, and a reply to a message asks about its thing. An answer that proposes an action, such as merging the release you asked about, comes with one ✅ **Confirm** button, which acts only while the thing still offers it.
- Every answer, draft and fix shows what its run of Claude took from your weekly limit, and a draft or fix that didn't come to be, such as when the limit is reached, says why and brings its button back.
- The pager tells you on Telegram only what needs you in your repositories: a contribution from outside, a required check or a release that fails on `main`, a code-scanning alert of severity high or critical, a green release pull request, and the token of Claude before it expires. Each thing is one message with buttons, edited in place as it changes, and what fails in a repository is bundled.
- Buttons act from a fixed list: 🔀 **Merge** a green release, ✍️ **Draft a reply** and ✅ **Send** it exactly as shown, 🤖 **Assistant again** on an issue, 🛠 **Start fix**, ⏰ **Later** and ✖ **Ignore**. Drafts, fixes and free text go to the private control repository.
- `scripts/register-app.mjs` registers the GitHub App from its manifest with the least permissions, and puts its secrets straight into the Worker; [Set up](https://dennis-otto.github.io/dennis-otto-pager/setup.html) walks through every step.
- The pager speaks German: set `LANGUAGE` to `de` in `wrangler.jsonc`, and every message, button, `/help`, answer of a button and the reminder of the token come in German, and so do the answers of the control repository. English stays the default, a draft of a reply keeps the language of its thread, and what comes from GitHub, such as a title, stays as it is.
