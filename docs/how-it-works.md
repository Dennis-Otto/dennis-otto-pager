# How it works

The pager is a Cloudflare Worker with three doors and a schedule: `/github` for the events of the GitHub App, `/telegram` for the updates of the bot, `/control` for the answers of the private control repository, and a run every 15 minutes. Each request proves where it comes from before anything else runs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/how-the-pager-works.dark.svg">
  <img src="images/diagrams/how-the-pager-works.svg" alt="How the pager works: GitHub sends the events of the GitHub App to the Worker on Cloudflare, signed with the secret of its webhook. The rules decide what needs Dennis; everything else ends there. What counts becomes one message in Telegram, edited in place as it changes, with buttons. A button runs an action of the allowlist on GitHub, such as merging a green release. Drafts, fixes and free text go to the workflow of the private control repository, which runs Claude Code with Dennis's subscription and sends its answer back, signed, as a draft, a note or a proposal that a button has to approve.">
</picture>

## What counts

`src/rules.ts` is the one place that decides; its tests go through each rule. An event of a repository of another owner, or of a kind that isn't listed here, ends without a message.

| Event | Counts when | Becomes |
| --- | --- | --- |
| `issues` opened, `pull_request` opened | Its author is neither the maintainer (`MAINTAINER_LOGIN`) nor a bot | A contribution, one message each |
| `check_run` completed on the default branch | The check is required by the rulesets of the branch and failed, timed out or didn't start | An entry of the alarm of the repository; a pass of the same check takes it out |
| `workflow_run` completed | `release.yml`, `build-release.yml` or `verify-release.yml` failed, outside a pull request | An entry of the alarm; a pass takes it out |
| `issues` opened by a bot | It has the label `bot-failure` of the bot-health bot | An entry of the alarm; its closing takes it out |
| `code_scanning_alert` created or reopened on the default branch | Its severity is high or critical | An entry of the code-scanning message of the repository; fixed or dismissed takes it out |
| `check_suite` completed on a branch of release-please | GitHub calls the pull request clean: open, no draft, into the default branch, every required check green and up to date | The release message with 🔀 **Merge** |
| `pull_request` synchronize, closed and merged; `release` published | It is the release that the message shows | The same message: *updated*, *merged*, *✅ published* |

A bundle whose last entry is gone turns green by itself, and a new failure after that opens a new message, which notifies.

## The buttons

`src/buttons.ts` is the allowlist: each kind of thing offers these buttons in these states, and a press runs only when the thing, as it is at the time of the press, still offers it.

| Thing | State | Buttons |
| --- | --- | --- |
| Contribution | new | ✍️ Draft a reply, 🤖 Assistant again (issues only), ⏰ Later, ✖ Ignore |
| Contribution | drafting | ⏰ Later, ✖ Ignore |
| Contribution | draft | ✅ Send, ✏️ Edit, ⏰ Later, ✖ Ignore |
| Alarm, code scanning | open | 🛠 Start fix, ⏰ Later, ✖ Ignore |
| Alarm, code scanning | fixing | ⏰ Later, ✖ Ignore |
| Release | ready | 🔀 Merge, ⏰ Later, ✖ Ignore |
| Reminder | open | ✅ Renewed, ⏰ Later |

- **🔀 Merge** asks GitHub for the pull request again and squash-merges it only at the head that the message showed, while it is still clean; a changed release goes back to waiting for its checks.
- **✅ Send** posts the draft whose version its button carries, exactly as the message showed it; an older button of the same thing refuses. **✏️ Edit** asks for the new text in reply to its prompt, and shows it as the next draft.
- **🤖 Assistant again** starts the workflow `issue-assistant.yml` of the repository on the issue with `override`, in the maintainer's name. A repository whose issue assistant doesn't take the override yet answers 422, and the button says so.
- **✍️ Draft a reply** and **🛠 Start fix** send the thing to the control repository, whose answer comes back as below. Each is a run of Claude with the maintainer's subscription, which counts against its weekly limit, and the answer names its model, its effort and its tokens; a job that fails brings its button back.
- **⏰ Later** brings the thing back as a new message after `LATER_HOURS`; **✖ Ignore** closes it.

## The control repository

The workflow of the private repository `Dennis-Otto/dennis-otto-pager-control` runs Claude Code with the maintainer's own subscription; its README describes its jobs, its safety and its set-up. The pager sends it a [repository dispatch](https://docs.github.com/rest/repos/repos#create-a-repository-dispatch-event), with a token of the app for that repository alone:

| Event type | Sent by | Client payload |
| --- | --- | --- |
| `pager-draft` | ✍️ Draft a reply | `item`, `repo`, `number`, `pull`, `language` |
| `pager-fix` | 🛠 Start fix | `item`, `repo`, `kind` (`alarm` or `alert`), `entries` with `label` and `url`, `language` |
| `pager-text` | A text that answers no prompt | `text`, `message` (its id in the chat), `reply`: the first 1000 characters of the message that the text answers, if any, and `thing`: the thing whose topic the text came from, if any; `language` |

`language` is `LANGUAGE` of the Worker, `en` or `de`: the control repository answers the maintainer in it, the note of a fix and the reason of a job that failed included, while a draft of a reply keeps the language of its issue or pull request.

A text in reply to a message of the pager is about its thing: *merge it*, in reply to the message of a release, names that release. So is a text in the topic of a thing, which carries the thing as `thing`: its `id`, `kind`, `repo` and `state`, the `number` of a contribution or a release and the `version` of a release, `links` to where GitHub shows it (its issue or pull request, or the page of a bundle and its entries, 21 at most) and `text`, its message as the maintainer sees it, in the HTML of Telegram, with what comes from GitHub escaped, 1500 characters at most. The key is `thing`, not `item`: the control workflow runs the jobs of one `item` one at a time, and a text keeps a run of its own. A workflow that doesn't know `thing` passes it over, so either side may deploy first. The pager sends no text of an issue: the workflow reads it from GitHub itself, as data. It answers with a `POST` to `/control`:

- the header `X-Pager-Timestamp`, the time in seconds since 1970, which may be five minutes off at most;
- the header `X-Pager-Signature`, `sha256=` and the HMAC with SHA-256, under `CONTROL_SECRET`, of the timestamp, a dot and the body;
- a body of JSON, one of those below.

The body is one of:

- `{"type": "draft", "item": "<id>", "text": "<reply>"}`: the draft of a reply for a contribution, at most 3000 characters, shown as a new message with ✅ Send;
- `{"type": "note", "item": "<id>", "text": "<note>"}`: a note below a thing, such as the pull request of a fix;
- `{"type": "note", "text": "<answer>"}`: a message of its own, such as the answer to free text;
- `{"type": "proposal", "text": "<answer>", "action": "<action>", "target": {"kind": "<kind>", "repo": "<owner/name>", "number": <number>}}`: an answer to free text that proposes one action, as a message of its own with a single ✅ Confirm button;
- `{"type": "failed", "item": "<id>", "text": "<why>"}`: a draft or a fix that didn't come to be, such as when the weekly limit is reached. The thing goes back to the state before its button, with the reason as its note, in a new message, so that the button can run again;
- `{"type": "failed", "text": "<why>"}`: free text whose answer didn't come to be, shown as a message of its own.

An answer to free text, a note or a failure without `item` or a proposal, carries `"message": <id>`, the `message` of its `pager-text`. The pager then turns the 👀 on that text into 👍, or into 😢 for a failure; a job started by hand in the Actions tab has no text, and leaves it out. The answer goes into the thread of that text, as [the thread of an answer](#the-thread-of-an-answer) says.

Each body may carry what the run of Claude took from the weekly limit of the subscription:

```json
"usage": {
  "turns": 4,
  "seconds": 52,
  "effort": "high",
  "models": [{"model": "claude-opus-5-5", "tokens": 48213}]
}
```

`effort` is the `--effort` that the workflow set: `low`, `medium`, `high`, `xhigh` or `max`. `models` names each model that worked, as many as five, with every token that it read and wrote, the cache included, from the `modelUsage` of the result in the transcript of the Claude Code action. The message shows it below the answer, on one line, in the language of the pager:

| Usage | English | German |
| --- | --- | --- |
| One model | *🧮 Opus 5.5 · high · 48,213 tokens* | *🧮 Opus 5.5 · Hoch · 48.213 Tokens* |
| Two models | *🧮 Opus 5.5 93%, Haiku 5.5 7% · extra high · 48,213 tokens* | *🧮 Opus 5.5 93 %, Haiku 5.5 7 % · Extra Hoch · 48.213 Tokens* |
| Without `models` | *🧮 Claude: 4 turns, 52 s, from your weekly limit* | *🧮 Claude: 4 Runden, 52 s, von deinem Wochenlimit* |

A model goes by its short name, such as *Opus 5.5* for `claude-opus-5-5`, *Haiku 3.5* for `claude-3-5-haiku-20241022` and *Fable 5.1* for `claude-fable-5-1`; an id of another form stays as it is. The effort in German is *Niedrig*, *Mittel*, *Hoch*, *Extra Hoch* or *Max*, and an effort that the pager doesn't know yet stays as Claude Code names it.

A proposal names its thing as the control repository knows it, and the pager looks it up:

| Action | Kind of thing | `number` |
| --- | --- | --- |
| `merge` | `release` | none |
| `assistant`, `draft` | `contribution` | the issue or pull request |
| `fix` | `alarm`, `alert` | none |
| `later`, `ignore` | any of the four | for a contribution |

✅ Confirm carries the data of the thing's own button, so a press runs the action only while the thing still offers it, as any press does, and then the button goes. A thing that the pager doesn't show, or that doesn't offer the action now, gets the answer without a button. ✅ Send and ✏️ Edit can't be proposed: they stay with the message of the draft, which shows the text that they post.

```sh
body='{"type":"note","text":"The fix is in #12."}'
stamp=$(date +%s)
signature=$(printf '%s.%s' "$stamp" "$body" | openssl dgst -sha256 -hmac "$PAGER_CONTROL_SECRET" -r | cut -d' ' -f1)
curl -s "$PAGER_URL/control" -H "X-Pager-Timestamp: $stamp" -H "X-Pager-Signature: sha256=$signature" -d "$body"
```

No body makes the pager act: whatever the control repository sends is shown, escaped, and never run, and every action needs the press of a button of the allowlist. The answer goes to the Worker rather than straight to Telegram, as [decision 0003](decisions/0003-the-control-repository-answers-the-worker.md) explains: the token of the bot stays in Cloudflare, and the Worker keeps the state that a draft, a failed job and a proposal need.

## The reaction on a text

A text to the bot shows where it is with one reaction, which the pager changes as the job goes on: a bot may set one reaction per message, from the fixed list of `ReactionTypeEmoji` in Telegram's Bot API. That list has no ✅, so 👍 stands for an answer, the closest to it, and 😢 for none.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-reaction-on-a-text.dark.svg">
  <img src="images/diagrams/the-reaction-on-a-text.svg" alt="The reaction on a text: Dennis writes a text to the bot, and the pager sends it to the control repository and reacts with 👀. When the answer or a proposal comes, the 👀 becomes 👍. When the job fails, it becomes 😢, and so does it when no answer came within an hour, which the schedule finds every 15 minutes. An answer that comes after that still turns it into 👍.">
</picture>

The jobs of the control repository take 40 minutes at most, so the pager waits an hour for the answer: the schedule, every 15 minutes, gives the 😢 to a text that still waits after that, between 60 and 75 minutes after it went. An answer that comes later still turns it into 👍, in the thread of its text.

## A topic per thing

Telegram's Bot API 9.4 lets a bot open topics in its private chat, with `createForumTopic`, once Threaded Mode is on for the bot in the Mini App of @BotFather ([Set up](setup.md#1-the-bot-of-telegram)). Then the first message of each thing opens a topic of its own, named after its repository, without its owner, and what the thing is, with a color per kind:

| Thing | Name of its topic | Color |
| --- | --- | --- |
| Contribution | 🙋 demo#12 It breaks | blue |
| Alarm | 🚨 demo needs you | red |
| Code scanning | 🛡 Code scanning in demo | yellow |
| Release | 📦 demo 1.2.3 | green |
| Reminder | 🔔 Token of Claude | violet |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/a-topic-per-thing.dark.svg">
  <img src="images/diagrams/a-topic-per-thing.svg" alt="A topic per thing: A new thing, such as an alarm, a contribution or a release, opens a topic of its own in the chat, named after its repository and what it is. Its message with the buttons comes first, and its changes edit it there. Its drafts, the prompt of Edit, what Later brings back and the answers to what Dennis asks in the topic follow in it; his question goes to the control repository together with the thing. Once the thing is done, its topic gets a check mark in front of its name and stays. Without Threaded Mode, or when Telegram refuses the topic or a message in it, the thing goes on in the main view, as before.">
</picture>

- **Everything about the thing is in its topic.** Its message with the buttons comes first, and its changes edit it in place, as before. A draft, a job that failed, the message that ⏰ Later brings back, the prompt of ✏️ Edit and the answers to texts written in the topic follow there.
- **A text in the topic of a thing is about that thing.** It goes to the control repository with the thing as `thing`, as the table above says, so a question such as *why?* needs no more words. A topic that the maintainer opens, and General, have no thing: a text there starts a conversation of its own, as before.
- **One topic per thing, never one per change.** The bundle of what fails in a repository keeps its topic, also when it opens again after it turned green, and so does its code scanning. A new version of a release that is still shown keeps the topic of the one that it replaces, renamed; the next release, after one was published or ignored, gets its own.
- **✅ once it is done.** A thing that is closed, or a release that is merged, gets ✅ in front of the name of its topic with `editForumTopic`, and a bundle that opens again loses it. Done topics stay, as the history of their things, as [decision 0005](decisions/0005-one-topic-per-thing-kept-when-done.md) explains: the maintainer deletes one by hand when it is no longer needed.
- **Topics of the maintainer.** The service message `forum_topic_created` of a topic that the maintainer opens is passed over, and each text in it is answered in it. Telegram may send the first text of a topic opened on a phone without its thread: its answer then goes into the main view.

Without topics, the pager writes into the main view, as before, and the thing works as it did:

- `getMe` doesn't say `has_topics_enabled`, since Threaded Mode is off;
- Telegram refuses `createForumTopic`;
- Telegram opens the topic but refuses the message in it with `message thread not found`, as a rollout of Telegram did in [tdlib/telegram-bot-api#847](https://github.com/tdlib/telegram-bot-api/issues/847): the pager deletes the empty topic again;
- the topic of a thing is gone, such as one that the maintainer deleted: the next message of the thing goes into the main view, and so do the ones after it. A bundle that opens again after its topic was deleted gets a new topic instead, so that the new incident has one of its own.

The prompt of ✏️ Edit then answers the message of its thing, so that it is clear what it is about, and a thing from before topics stays in the main view until it closes. Each of these cases logs a warning with Telegram's answer, never the name of the topic or a text.

## The thread of an answer

Telegram's Bot API 9.3 gave the private chat of a bot threads, and with Threaded Mode on for the bot, in the Mini App of @BotFather, each new text of the maintainer can start a thread of its own. An answer to a text goes into the thread that the text came from, read from its `message_thread_id`: the answer to `/help`, an error such as a missing control repository or a draft that is gone, and the answer of the control repository, whether a note, a failure or a proposal with its ✅ Confirm button. The reactions need no thread, since they sit on the text itself.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-thread-of-an-answer.dark.svg">
  <img src="images/diagrams/the-thread-of-an-answer.svg" alt="The thread of an answer: Dennis writes a text in a thread of the chat. The answer to /help or an error goes into that thread at once. Free text goes to the control repository, and the pager keeps its thread while it waits. The answer of the control repository, a note, a failure or a proposal with its Confirm button, goes into the same thread. General, a text from before threads, an answer more than a day late and a thread that Telegram doesn't find get theirs in the main view.">
</picture>

The control repository never sees the thread: the pager keeps it with the text that waits for its answer, and the `message` of the answer finds it again, so the contract stays as it was. Some answers go into the main view instead:

- a text from General, the first thread, whose messages the Bot API takes without the id of a thread;
- an answer to no text, such as one of a job started by hand;
- an answer to a text that went before the pager knew threads, and one that comes more than a day after its text: the pager keeps the thread of a text that it gave up on for a day, so a late answer still finds it;
- an answer whose thread Telegram doesn't find, with `message thread not found`, such as one that the maintainer deleted: the pager sends it again without the thread and logs that, without its text.

The messages of the things, such as a release or a failing check, go into their topics, as [a topic per thing](#a-topic-per-thing) says.

## Texts and languages

Every text that the pager sends comes from `src/texts.ts`, one catalog per language, English and German, and `LANGUAGE` in `wrangler.jsonc` chooses one: the messages and their states, the buttons, `/help`, the answers of the buttons, the errors that it shows and the reminder of the token. A text names its parts in braces, such as `{repo}`, and what fills them, such as the title of an issue or the name of a check, goes in as GitHub says it. The rules hand on what they mean, such as why a release may not merge yet, as a key of the catalog with its values, and the pager words it; the logs stay in English. Both catalogs have the same keys, which the compiler checks, and the same placeholders, tags and emojis, which `test/texts.test.ts` checks: a new text takes an entry in both.

After a change of `LANGUAGE`, a message speaks the new language once its thing changes; what its record keeps as text, such as its note, the entries of a bundle and the reminder, keeps the words that it was written with.

## State

Workers KV holds one record per thing: its kind, state, repository, the id of its message, the thread and the name of its topic and, for a contribution, the draft; a closed thing expires after 30 days. A link from the thread of a topic to its thing, `topic:<thread>`, lets a text in the topic find it: one write when the topic opens and one when it is renamed, and it expires 30 days after its thing is done. The time of a "Later" is in the metadata of its record, so the schedule finds what is due with one list, the prompt of an edit lives for a day, and one record keeps the texts that wait for their answer, with the time that each went and the thread that it came from, so the schedule reads it once per run and writes it only when a text comes or goes. Each change of a thing is one write, as the free plan of Workers KV wants it. Nothing secret is stored, and the logs name the answers of the APIs only, never a token or the text of an issue.

Workers KV has no compare-and-swap, and a write shows in other places of the network only after a while. So the Worker hands every request that passed its checks of route and method to one Durable Object, `Serial` in `src/serial.ts`, which runs the changes one after another, in one place: two required checks that fail at the same moment end in one message with both, and a ✅ Send pressed twice posts once. The object keeps nothing itself; it is one of SQLite, which the free plan of Workers offers.
