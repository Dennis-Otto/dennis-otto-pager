# Changelog

All notable changes, by release. Each pull request that changes something for
users describes it in a file of its own in `changelog.d/`, or under Unreleased. The
release bot makes that text the section of the next release, or lists the pull
requests when there is none.

## Unreleased

## [0.3.0](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.2.2...v0.3.0) (2026-11-04)

### Features

- Each thing gets a topic of its own in the chat, once Threaded Mode is on for the bot: an alarm, a contribution, a release, code scanning and the reminder of the token. Its message with the buttons comes first, and its drafts, the prompt of ✏️ Edit and the answers to what you ask in the topic follow there. A question in the topic of a thing goes to the control repository with that thing, so "why?" is enough. A done thing gets ✅ in front of its topic, which stays as its history; without topics, everything stays in the main view, as before.

## [0.2.2](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.2.1...v0.2.2) (2026-11-04)

### Bug fixes

- Each answer to your text stays in the thread that you wrote it in, now that the bot has threads: `/help`, an error, and the answer of the control repository with its ✅ Confirm button. A text from General, and an answer whose thread is gone, get theirs in the main view.

## [0.2.1](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.2.0...v0.2.1) (2026-11-04)

### Bug fixes

- Keep the deploys on the namespace the first one created.

## [0.2.0](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.1.0...v0.2.0) (2026-11-04)

### Features

- Each answer, draft and fix of Claude ends with one line that names the model, the effort and every token of its run, such as *🧮 Opus 5.5 · high · 48,213 tokens*, or *Opus 5.5 · Hoch · 48.213 Tokens* in German, with the share of each model when more than one worked.
- Your text to the pager shows when it is done: its 👀 turns into 👍 when the answer comes, and into 😢 when the job failed or no answer came within an hour. Telegram lets a bot react only with a fixed set of emojis, which has no ✅.

## 0.1.0 (2026-11-04)

### Features

- Write to the pager in your own words: the private control repository answers with Claude, and a reply to a message asks about its thing. An answer that proposes an action, such as merging the release you asked about, comes with one ✅ **Confirm** button, which acts only while the thing still offers it.
- Every answer, draft and fix shows what its run of Claude took from your weekly limit, and a draft or fix that didn't come to be, such as when the limit is reached, says why and brings its button back.
- The pager tells you on Telegram only what needs you in your repositories: a contribution from outside, a required check or a release that fails on `main`, a code-scanning alert of severity high or critical, a green release pull request, and the token of Claude before it expires. Each thing is one message with buttons, edited in place as it changes, and what fails in a repository is bundled.
- Buttons act from a fixed list: 🔀 **Merge** a green release, ✍️ **Draft a reply** and ✅ **Send** it exactly as shown, 🤖 **Assistant again** on an issue, 🛠 **Start fix**, ⏰ **Later** and ✖ **Ignore**. Drafts, fixes and free text go to the private control repository.
- `scripts/register-app.mjs` registers the GitHub App from its manifest with the least permissions, and puts its secrets straight into the Worker; [Set up](https://dennis-otto.github.io/dennis-otto-pager/setup.html) walks through every step.
- The pager speaks German: set `LANGUAGE` to `de` in `wrangler.jsonc`, and every message, button, `/help`, answer of a button and the reminder of the token come in German, and so do the answers of the control repository. English stays the default, a draft of a reply keeps the language of its thread, and what comes from GitHub, such as a title, stays as it is.
