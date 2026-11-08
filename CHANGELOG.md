# Changelog

All notable changes, by release. Each pull request that changes something for
users describes it in a file of its own in `changelog.d/`, or under Unreleased. The
release bot makes that text the section of the next release, or lists the pull
requests when there is none.

## Unreleased

## [0.7.1](https://github.com/Dennis-Otto/repo-pager/compare/v0.7.0...v0.7.1) (2026-11-08)


### Bug fixes

* a message of a thing whose topic you deleted opens a new topic instead of the main chat ([#106](https://github.com/Dennis-Otto/repo-pager/issues/106)) ([85881db](https://github.com/Dennis-Otto/repo-pager/commit/85881db0e9b56cdea5b380477514a85596c7bf7b))

## [0.7.0](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.6.0...v0.7.0) (2026-11-08)

### Features

- The pager follows the comments of an issue or a pull request of someone else. A new comment of someone else edits the message of its thing to name the comment, and one notice in its topic tells you, once for a few quick comments; a draft that you asked for is written again for the comment, and your own text with ✏️ Edit stays your draft. Once its reply went, the thing opens again with ✍️ Draft a reply, and an issue from before the pager comes as a new thing. Your own comment on GitHub, and the issue or the pull request closed or merged, make the thing done, without buttons, so ✅ Send can't post a second answer. The comments need the event *Issue comment*, which you tick in the settings of the app.
- A message shows what its thing says, so you rarely need to open GitHub. A new issue, pull request, discussion or comment quotes the first 500 characters of its text as a folded quote, without the hidden hints of its form. A release shows its notes from its pull request: the headings in bold, each item with its pull request linked, 15 lines at most and *… and N more* for the rest, and *⚠️ Breaking changes* above them when the notes name breaking changes or the major version goes up from 1 or above, so you know what 🔀 Merge publishes. Notes changed on the pull request show in the message too.
- An event of GitHub that the pager failed to handle, such as in a short outage of Telegram, comes again by itself: GitHub never delivers a failed webhook again on its own, so every 15 minutes the pager has it delivered again, three attempts in all. An event whose attempts all fail shows once in the alarm of the control repository, *🚨 An event of GitHub fails: pull_request.opened*, with a link to the recent deliveries on the app's Advanced page, and an attempt that passes later takes it out. A discussion or a comment that comes twice no longer sends its message again or asks for a second draft. An event that a newer one of its kind in the same repository has overtaken, such as a failed run before a rerun that passed, doesn't come again, so a late copy can't bring back an older state; a short wait that Telegram asks for in a burst of messages is honoured once; and an alarm of such events offers no 🛠 Start fix. It needs no new permission and no new secret.
- The pager tells you of a private vulnerability report and of a secret that secret scanning found, which GitHub announced only by mail. A report gets a message of its own, *🔐 Vulnerability report in demo*, with its severity, its link and the days by which `SECURITY.md` promises to acknowledge and to assess it, and ⏰ Later and ✖ Ignore; what the report says stays on GitHub while it is under embargo, so no message, record or log of the pager names its summary or its description. On the day before its acknowledgement is due, a report that still waits in triage comes again, once, and its advisory published ticks it ✅. A secret is an entry of the security message of its repository, which is what the message of code scanning is called now, *🛡 Security in demo*: the kind of the secret and its file, such as *🔑 Mailchimp API Key in config/.env*, never the secret, and *leaked in public too* when GitHub found it in public; resolved takes it out. The app needs the permissions *Repository security advisories: Read* and *Secret scanning alerts: Read* and the events *Repository advisory* and *Secret scanning alert*, which you give it in the settings of the app, as the setup says.
- The pager tells you before it breaks. Three weeks before `GITHUB_USER_TOKEN` of ✅ Send and 🤖 Assistant again expires, a 🔔 reminder in a topic of its own names the day and how to renew it: the pager reads the day from GitHub once a day, so no setting names it, and a token that GitHub refuses, because it expired or was revoked, gets a reminder too. The same reminder comes for `PAGER_FIX_TOKEN` of 🛠 Start fix, whose day the daily check of the control repository sends along. ✅ Send and 🤖 Assistant again say that GitHub refuses the token, instead of a bare refusal. The control repository can now ask the pager for its health with the signed body `{"type": "health"}`: when its schedule last ran, whether Telegram takes the bot and delivers its webhook, whether GitHub takes the app, and the days of the tokens, without a secret; its daily check fails, which GitHub notifies by itself, when one of them is wrong. It needs no new permission and no new secret.
- Any workflow that fails on `main` pages you once, not as a mail of GitHub per run: a push, a schedule, a bot such as *Findings* or *After the checks*, or a start by hand. Its message, such as *🔴 Docs fails on main in Dennis-Otto/player-switch-for-autodarts*, names the jobs that failed, each linked to its log, and offers 🔁 **Rerun** of the failed jobs and ✖ **Ignore**. Each run that fails again edits it in place, with how often and when, without a notification, and a run that passes the jobs that failed turns it ✅. A first attempt waits ten minutes for the rerun that *After the checks* makes of the tests and of a release, so a rerun that passes never pages. A required job of GitHub Actions now pages as its workflow, and an issue of the bot-health bot as the run that it names, so the same failure no longer pages twice. With this, you can turn off the mails of GitHub Actions in your notification settings; keep *Web and Mobile* on, or keep the mails of the control repository with a filter, since the failed *Health* run of a broken pager reaches you only that way. It needs no new permission and no new event of the app.

### Bug fixes

- The album of a visual change shows the changed pixels in red, as its message promised: each picture whose check drew its difference starts with it, *🔴 Changed pixels*, before and after follow, and a GIF, which can't be a photo, shows its difference alone instead of staying behind the link. The link to the run of the check promises *each changed pixel in red* only when its artifacts have the difference of a picture; otherwise it says *All of them before and after*. Which pictures have a difference depends on the visual check of each repository: most draw it for PNG files only today, and for WebP and GIF files too once they take the difference that the blueprint's `keep` draws. It needs no new permission and no new secret.

## [0.6.0](https://github.com/Dennis-Otto/dennis-otto-pager/compare/v0.5.0...v0.6.0) (2026-11-08)

### Features

- When none of the buttons of a question of your agent fits, write your answer in its topic: it reaches the agent in your own words, in the same file as a button, the message shows it, and your text gets 👍.
- An agent can take back a question that it no longer needs, with `node scripts/ask.mjs withdraw` of the control repository: the buttons go, and the message says that the agent took it back, with its reason.
- A discussion that is dealt with on GitHub itself is done in the pager too: when you reply there, someone marks an answer, or the discussion is closed or deleted, its message loses its buttons, says why, and its topic gets ✅, so ✅ Send can't post a second answer. A text that you wrote with ✏️ Edit stays your draft: a draft of the control repository that comes later only shows in the topic to read, and a new comment keeps your text instead of asking for a new draft.

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
