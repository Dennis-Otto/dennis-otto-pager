# Changelog

All notable changes, by release. Each pull request that changes something for
users describes it in a file of its own in `changelog.d/`, or under Unreleased. The
release bot makes that text the section of the next release, or lists the pull
requests when there is none.

## Unreleased

## [0.6.0](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.5.0...v0.6.0) (2026-11-08)


### Features

* a discussion thing closes when Dennis answers on GitHub, and keeps his own draft ([#74](https://github.com/Dennis-Otto/dennis-otto-pager/issues/74)) ([d11b4b8](https://github.com/Dennis-Otto/dennis-otto-pager/commit/d11b4b88c6b83b5348d28534659668d4c402e090))
* Dennis can answer a decision in his own words, and an agent can take a question back ([#78](https://github.com/Dennis-Otto/dennis-otto-pager/issues/78)) ([a64a476](https://github.com/Dennis-Otto/dennis-otto-pager/commit/a64a4761fa778879a290ea915efa77550335ba82))

## [0.5.0](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.4.0...v0.5.0) (2026-11-08)

### Features

- Your own agents, such as an orchestrator that works through the night on your PC with `gh`, can ask you a question through the pager: it comes in a topic of its own, *🤔 Decision: …*, with its two to four options as buttons, and your press saves the answer as `answers/<id>.json` on the branch `pager-answers` of the private control repository, where the agent reads it with `gh`. The answer shows in the message, and the topic gets ✅. A run can also send its report, which comes in a topic of its own, *🧾 Run: …*. The control repository forwards both, signed, and only those that its owner sent; the GitHub App needs no new permission.
- A new discussion, or a comment on one, by someone other than you or a bot pages you as a thing with its own topic, and comes with a draft of a reply in your voice right away. ✅ Send posts the draft as the pager's app, in the thread of the comment that it answers, ✏️ Edit changes it, and ✖ Ignore leaves the discussion alone. A discussion that you started, and one whose answer was chosen, stay quiet. An app registered before needs the permission *Discussions: Read and write* and the events *Discussion* and *Discussion comment*.
- A 🛠 Start fix that finds an outage of GitHub or of a download in the logs, such as a 504, a timeout or a connection to api.github.com that failed, answers in the alarm's topic with one ✅ Confirm button for 🔁 Rerun, which runs the failed jobs again, instead of telling you to rerun them on GitHub. The alarm keeps its message and gets its buttons back. A control repository that doesn't propose it yet still answers with text, as before.
- A pull request of yours or of a bot that changes how something looks now shows its pictures in the chat: when its visual check passes and a picture looks different, the pager sends the largest changes before and after as one album, three at most, into the topic of the pull request, or of its release, with the list of what changed and a link to the run of the check. It comes at most once per head of the pull request and never for someone else's pull request; ✖ Ignore stops it, and the merge or the close of the pull request ticks its topic off. The app reads the pictures with the permission *Actions* that it has already, so nothing new needs to be set up.

## [0.4.0](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.3.1...v0.4.0) (2026-11-05)

### Features

- An alarm whose entry names a run of GitHub Actions that failed on `main`, such as a required check, a release run or an issue of the bot-health bot, offers 🔁 Rerun. It reads the run first and runs its failed jobs again, as "Re-run failed jobs" on GitHub does, without a run of Claude: for a short outage of GitHub, such as a download that answered 504. A run that still runs, or that passed on a retry, stays as it is, and the button says so. While the jobs run again, the entry says *🔁 running again…*; a pass takes the entry out, and the last one turns the alarm ✅. The GitHub App asks for *Actions: Read and write* for it.

### Bug fixes

- A thing whose job of the control repository sent no answer within the hour, after ✍️ Draft a reply or 🛠 Start fix, gets its buttons back, once, as a new message with the note *⌛ No answer from the control repository*, instead of waiting forever.

## [0.3.1](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.3.0...v0.3.1) (2026-11-05)

### Bug fixes

- The answer of 🛠 Start fix comes into the topic of its thing as a new message that notifies you, also when the fix opened a pull request; only a thing without a topic shows it in the main view. The alarm of a release run that failed names the attempt that failed, so that the fix reads the jobs and logs of that attempt instead of a rerun that still runs, and can say that the rerun is on its way.

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
