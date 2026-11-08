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
| `discussion` created, `discussion_comment` created | Its author is neither the maintainer nor a bot, the discussion isn't one of the maintainer, and no answer of Q&A was chosen | A contribution with its draft at once, one per discussion; a new comment makes itself the message that the reply answers ([below](#a-discussion)) |
| `discussion` answered, closed or deleted; `discussion_comment` created by the maintainer | The discussion isn't one of the maintainer | Its open thing is done, and its message says why ([below](#a-discussion)) |
| `issue_comment` created | Its author is neither the maintainer nor a bot, on an issue or a pull request of neither | The newest message of its contribution: an open thing names it in place and notifies once, a thing whose reply went or that GitHub dealt with opens again, and an unknown one comes as new ([below](#a-comment-on-an-issue-or-a-pull-request)) |
| `issue_comment` created by the maintainer; `issues` closed; `pull_request` closed and merged or not | The issue or the pull request is neither of the maintainer nor of a bot | Its open thing is done, and its message says why ([below](#a-comment-on-an-issue-or-a-pull-request)) |
| `check_run` completed on the default branch | The check is required by the rulesets of the branch and failed, timed out or didn't start | An entry of the alarm of the repository; a pass of the same check takes it out |
| `workflow_run` completed | `release.yml`, `build-release.yml` or `verify-release.yml` failed, outside a pull request | An entry of the alarm; a pass takes it out |
| `issues` opened by a bot | It has the label `bot-failure` of the bot-health bot | An entry of the alarm; an edit of the open issue, as the bot makes one at each new failure, changes the entry and opens nothing; its closing takes it out |
| `code_scanning_alert` created or reopened on the default branch | Its severity is high or critical | An entry of the code-scanning message of the repository; fixed or dismissed takes it out |
| `check_suite` completed on a branch of release-please, or its `pull_request` edited | GitHub calls the pull request clean: open, of the repository itself, no draft, into the default branch, every required check green and up to date | The release message with its notes and 🔀 **Merge**; new notes at the same head edit it in place |
| `pull_request` synchronize, closed and merged; `release` published | It is the release that the message shows | The same message: *updated*, *merged*, *✅ published* |
| `workflow_run` completed | `visual.yml`, the visual check, passed on a pull request of the repository at its head, which is one of the maintainer or of a bot, and a picture looks different | The pictures before and after, in the topic of the release or of a thing of their own ([below](#the-pictures-of-a-visual-change)) |
| `pull_request` closed | It is one of the maintainer or of a bot whose pictures the pager shows | Its pictures are done: ✅ in front of their topic |

A bundle whose last entry is gone turns green by itself, and a new failure after that opens a new message, which notifies. An entry of the alarm keeps the run of GitHub Actions that failed, where it names one: a required check by the address of its job, such as `…/actions/runs/31/job/2`, a release run by its id, and an issue of the bot-health bot by the run in the marker of its body, `<!-- bot-health {"run": 31, …} -->`, which the bot writes anew at each failure. Such an entry gives the alarm 🔁 **Rerun**.

A message shows what its thing says, so that it needs no visit to GitHub. A contribution quotes the first 500 characters of its issue, pull request, discussion or comment, without the HTML comments of its form, escaped and folded as `<blockquote expandable>`, in the room that its draft and its note leave below the 4096 characters of Telegram. A release shows the notes of its pull request, after `<!-- The notes of the release follow. -->` or else the first `---`: headings in bold, items as *• text #56* with the number linked and the links to commits left out, at most 15 lines or 1200 characters and *… and N more* for the rest, below *⚠️ Breaking changes* when the notes have a section of breaking changes or the major version goes up from 1 or above.

## The buttons

`src/buttons.ts` is the allowlist: each kind of thing offers these buttons in these states, and a press runs only when the thing, as it is at the time of the press, still offers it.

| Thing | State | Buttons |
| --- | --- | --- |
| Contribution | new | ✍️ Draft a reply, 🤖 Assistant again (issues only), ⏰ Later, ✖ Ignore |
| Contribution | drafting | ⏰ Later, ✖ Ignore |
| Contribution | draft | ✅ Send, ✏️ Edit, ⏰ Later, ✖ Ignore |
| Discussion | new | ✍️ Draft a reply, ✖ Ignore, only when its draft couldn't be asked for, or its job failed or didn't answer within the hour |
| Discussion | drafting | ✖ Ignore |
| Discussion | draft | ✅ Send, ✏️ Edit, ✖ Ignore |
| Contribution, discussion | sent, done, ignored | None; a new comment of someone else opens one that was sent or done again: an issue or a pull request with the buttons of *new*, a discussion with its draft at once (*drafting*) |
| Alarm | open | 🔁 Rerun (where an entry names a run), 🛠 Start fix (unless every entry is an event of GitHub that fails), ⏰ Later, ✖ Ignore |
| Code scanning | open | 🛠 Start fix, ⏰ Later, ✖ Ignore |
| Alarm, code scanning | fixing | ⏰ Later, ✖ Ignore |
| Release | ready | 🔀 Merge, ⏰ Later, ✖ Ignore |
| Pictures | open | ✖ Ignore |
| Reminder | open | ✅ Renewed, ⏰ Later |
| Question of an agent | open | One button per option (no ⏰ Later, no ✖ Ignore) |

- **🔀 Merge** asks GitHub for the pull request again and squash-merges it only at the head that the message showed, while it is still clean; a changed release goes back to waiting for its checks.
- **✅ Send** posts the draft whose version its button carries, exactly as the message showed it, in the maintainer's name, and in a discussion as the app; an older button of the same thing refuses. **✏️ Edit** asks for the new text in reply to its prompt, and shows it as the next draft, which is the maintainer's own from then on: no draft of the control repository replaces it, not even that of a job which still runs.
- **🤖 Assistant again** starts the workflow `issue-assistant.yml` of the repository on the issue with `override`, in the maintainer's name. A repository whose issue assistant doesn't take the override yet answers 422, and the button says so.
- **🔁 Rerun** reads each run that the entries name, with a token of the app for `actions: read`, and runs its failed jobs again, as *Re-run failed jobs* on GitHub does, with a token for `actions: write`. A run that still runs, or whose newer attempt runs, and one that passed on a retry stay as they are, and the button says so. The entries of a run that runs again show *🔁 running again…* in the message, edited in place, until the run fails again or passes: a pass closes the issue of the bot-health bot or ends the failure of the release, which takes the entry out, and the last one turns the alarm ✅. It costs no run of Claude, so it comes first, for a short outage of GitHub, such as a download that answered 504.
- **✍️ Draft a reply** and **🛠 Start fix** send the thing to the control repository, whose answer comes back as below. Each is a run of Claude with the maintainer's subscription, which counts against its weekly limit, and the answer names its model, its effort and its tokens; a fix that finds an outage of GitHub or of a download in the logs, such as a 504, a timeout or `error connecting to api.github.com`, changes nothing and proposes 🔁 **Rerun** with one ✅ **Confirm** button; a job that fails brings its button back, and so does a job that sent no answer within the hour: the schedule gives its thing the buttons back once, as a new message with the note *⌛ No answer from the control repository*.
- **One button per option** answers the [question of an agent](#questions-and-reports-of-your-agents) and saves the answer; a text in its topic answers it in the maintainer's own words.
- **⏰ Later** brings the thing back as a new message after `LATER_HOURS`; **✖ Ignore** closes it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-rerun-of-a-run.dark.svg">
  <img src="images/diagrams/the-rerun-of-a-run.svg" alt="The rerun of a run that failed: An entry of the alarm names a run of GitHub Actions that failed on main, such as that of a required check, a release or an issue of the bot-health bot. Dennis presses Rerun, and the pager reads the run. While it still runs, or once it passed on a retry, the button says so and nothing starts. Otherwise its failed jobs run again, and the entry says so in the message. When they fail again, the entry shows the failure, and Rerun can run them once more. When they pass, the bot-health bot closes its issue or the release run passes, the entry goes, and the last one turns the alarm green.">
</picture>

## A discussion

A new discussion, or a comment on one, by someone other than the maintainer or a bot is a contribution as well, with a topic of its own, such as *💬 demo#31 How do I start?*. The pager asks the control repository for its draft as it comes, since its buttons send, edit or ignore that draft, as [decision 0006](decisions/0006-a-discussion-gets-its-draft-at-once-and-the-reply-of-the-app.md) explains: the message shows the discussion, or the comment with its author, and *✍️ The control repository drafts a reply…*, and the draft follows with ✅ **Send**, ✏️ **Edit** and ✖ **Ignore**. ✅ Send posts exactly that draft with `addDiscussionComment` of GitHub's GraphQL API, with a token of the app for `discussions: write` of that one repository, so the reply shows as that of the app: on the discussion itself, or in the thread of the comment that it answers, which for a reply to a reply is the thread of its parent, since GitHub nests one level only. A draft that couldn't be asked for, as when the app isn't installed on the control repository, leaves the message with ✍️ **Draft a reply** and a note that says why.

A discussion is one thing, keyed by its number, which GitHub counts together with those of issues and pull requests. A new comment of someone else makes itself the message that the reply answers, with a new draft: while the thing is open, a new message replaces the old one, and once its reply went, the thing opens again in its topic, where the old message stays as history. A discussion that the maintainer ignored stays ignored, until its record expires 30 days later. No thing comes from a discussion of the maintainer, comments included, since GitHub tells its author of each comment itself, from one of Q&A whose answer was chosen, or from the app's own replies, which come back as comments of a bot.

A discussion that GitHub dealt with needs no reply of the pager, as pictures need none once their pull request closed: when the maintainer replies on GitHub itself, to the discussion or in any of its threads, when someone marks an answer, or when the discussion is closed or deleted, its open thing is done. Its buttons go, its topic gets ✅, and its message says why, such as *💬 You replied on GitHub, so the pager sends nothing.*, edited in place, which notifies nobody. A job that still drafts for it finds the thing done, and its draft isn't shown. A new comment of someone else opens it again afterwards, as it does once a reply went, unless an answer was chosen.

A draft that the maintainer wrote with ✏️ Edit stays his ([decision 0009](decisions/0009-a-discussion-that-github-dealt-with-is-done-and-an-own-draft-stays.md)). A job that was still drafting when his text came, such as one for a newer comment, no longer replaces it: its draft goes into the topic of the thing as a message to read, without buttons, and ✅ Send still posts his text. A new comment of someone else keeps it too: the new message shows the comment with his text as its draft, a note says so, and no job drafts another one, so ✏️ Edit is how it changes for the new comment.

The control repository runs the jobs of one thing one at a time. A comment that comes while the draft of an older one is still being written waits for it: the pager shows the new comment at once, drops the older draft when it comes, so that no reply to the older comment can go into the thread of the newer one, and asks for the draft of the newest comment then. ✅ Send posts on the discussion itself when the comment that it answers is gone, as GitHub's `NOT_FOUND` for it says, so that the approved reply isn't lost.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-reply-to-a-discussion.dark.svg">
  <img src="images/diagrams/the-reply-to-a-discussion.svg" alt="The reply to a discussion: Someone other than Dennis or a bot opens a discussion or comments on one. A discussion of Dennis, and one whose answer was chosen, end there. Otherwise the pager shows it in its topic and asks the control repository for a draft at once, which Claude writes in Dennis's voice. The draft comes with Send, Edit and Ignore. Send posts exactly that draft as the pager's app, in the thread of the comment that it answers, or on the discussion itself. A new comment of someone else makes itself the message to answer, with a new draft, in the same topic, while a text that Dennis wrote himself stays the draft. When Dennis replies on GitHub itself, an answer is marked, or the discussion is closed, the thing is done: its buttons go, and its topic gets a check mark.">
</picture>

## A comment on an issue or a pull request

A comment of someone other than the maintainer or a bot on an issue or a pull request of someone else is the newest message of its contribution, which the reply answers, so that an answer to the maintainer's question reaches the chat, as a new comment on a discussion does ([decision 0011](decisions/0011-a-comment-on-an-issue-or-a-pull-request-edits-its-thing-and-notifies-once.md)). An issue or a pull request of the maintainer or of a bot makes no thing, comments and all, since GitHub tells its author of each comment itself, and a comment of a bot, such as one of the issue assistant, means nothing.

- **An open thing** keeps its message: it names the comment and its author, such as *💬 New comment on an issue in demo by hubot*, with the link to the comment, edited in place, which notifies nobody. So one message below it in its topic does, *💬 hubot commented: #12 It breaks*, and in a chat without topics as an answer to its message. The comments that follow within ten minutes edit the message alone, so a few quick comments notify once. A draft that the maintainer asked for is written again for the comment: a job that still drafts drops its draft when it comes and asks for the next one, and a draft that is shown goes, and a new one is asked for at once. A text that he wrote with ✏️ Edit stays his draft, as in a discussion, with a note that a new comment came.
- **A thing whose reply went**, or that GitHub dealt with, opens again in its topic with ✍️ **Draft a reply**, where the old message stays as history, as a new message, which notifies.
- **An ignored thing** stays ignored, until its record expires 30 days later.
- **An unknown thing**, from before the pager or whose record expired, comes as a new one.

The same comment twice, as GitHub delivers an event again when its answer was lost, changes nothing. A comment of the maintainer on GitHub itself, and the issue closed or the pull request closed or merged, make the open thing done, as for a discussion: its buttons go, its topic gets ✅, and its message says why, such as *💬 You replied on GitHub, so the pager sends nothing.*, *Closed on GitHub.* or *🔀 Merged.*, edited in place. ✍️ Draft a reply then sends `issueComment` with the thing, the comment that the reply answers. All this needs the event *Issue comment* of the app, which its permissions *Issues* and *Pull requests* cover; without it, a thing still closes with its issue or pull request.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-comments-of-a-contribution.dark.svg">
  <img src="images/diagrams/the-comments-of-a-contribution.svg" alt="The comments of a contribution: Someone other than Dennis or a bot comments on an issue or a pull request of someone else. A comment on one of Dennis or of a bot, the same comment again and an ignored thing end there. A thing that is open names the comment in its message, edited in place, and one message below it in its topic notifies, once for a few quick comments; a draft that Dennis asked for is written again for the comment, while a text that he wrote himself stays the draft. A thing whose reply went, or that GitHub dealt with, opens again in its topic with Draft a reply, and an issue that the pager never showed comes as a new thing. When Dennis comments on GitHub itself, or the issue or the pull request closes, the thing is done: its buttons go, and its topic gets a check mark.">
</picture>

## The pictures of a visual change

A repository whose pictures show its app, such as paperless-unified-search, runs a visual check on each pull request that changes what they show: its `visual.yml` renders the pictures again, compares each with the committed one by its pixels, and keeps each one that looks different in an artifact of its run, before and after, with `report.json`, their list with the share of the pixels that changed. When the check passed on a pull request of the maintainer or of a bot, the pager shows those pictures in the chat, as [decision 0007](decisions/0007-the-pictures-of-a-visual-change-come-from-the-artifacts-of-its-check.md) explains:

- **Whose:** the pager asks GitHub for the pull request first. One of someone else, one from a fork, whose run names no pull request, and one that moved on to a newer head get nothing: what someone else's pull request renders is theirs, and a newer head brings a check of its own.
- **Where:** the release pull request that the pager shows gets them in the topic of the release, below a message of their own, so that its own message keeps 🔀 **Merge**. Any other gets a thing of its own, such as *🖼 demo#8 Make it blue*, whose message lists the pictures that look different, with how much of each changed, and links the run of the check, whose artifacts have them all, each changed pixel in red. Its one button is ✖ **Ignore**, which stops its pictures; the merge or the close of the pull request ends it, with ✅ in front of its topic.
- **What:** an album, with `sendMediaGroup` of the Bot API, of the largest changes before and after: three pictures at most, PNG or WebP files of at most 5 MB, of a size that Telegram takes as a photo. A GIF, a video and a larger file stay behind the link. The album right after a new message comes quietly, so that both notify once.
- **How often:** one album per head of the pull request at most. A check that runs again at the same head sends nothing, and a newer head whose pictures look different edits the message in place, with an album that notifies. A newer head whose pictures all look as committed again says so in the message, in place; a pull request whose pictures never changed sends nothing at all.
- **How:** with a token of the app for `actions: read` of that one repository, which the app has for 🔁 **Rerun**, so no secret is new. The pager lists the artifacts of the run, `visual` or one per language, such as `visual-en`, and asks GitHub for the ZIP of each, 32 MB at most together, which answers with the address of its storage, signed for a minute. The pager follows it without the token, which goes to GitHub alone, reads the ZIP in memory, and inflates only the report and the pictures of the album, never to more than the size that the ZIP gives them. It reads the reports of each repository: their list is `pictures` or `images`, a picture is new or added, deleted or removed, and its files are named in its entry or are its path in `before/` and `after/`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-pictures-of-a-visual-change.dark.svg">
  <img src="images/diagrams/the-pictures-of-a-visual-change.svg" alt="The pictures of a visual change: Dennis or a bot pushes to a pull request that changes how something looks, and its visual check renders the pictures again and keeps each one that looks different in an artifact, before and after. When the check passed, the pager asks GitHub for the pull request, with a token of its app. One of someone else, from a fork, or that moved on to a newer head ends there, and so does a head whose pictures went already. Otherwise the pager reads the artifact with the same token, through the short-lived address of its storage. When every picture looks as committed, nothing comes. When some look different, their message goes into the topic of its release, or of a thing of their own, and the album of the largest changes follows, before and after, at most three pictures. The merge or the end of the pull request ticks the topic off.">
</picture>

## The control repository

The workflow of the private repository `Dennis-Otto/dennis-otto-pager-control` runs Claude Code with the maintainer's own subscription; its README describes its jobs, its safety and its set-up. The pager sends it a [repository dispatch](https://docs.github.com/rest/repos/repos#create-a-repository-dispatch-event), with a token of the app for that repository alone:

| Event type | Sent by | Client payload |
| --- | --- | --- |
| `pager-draft` | ✍️ Draft a reply, and a discussion or a comment on one as it comes | `item`, `repo`, `number`, `pull`, `language`; for a discussion also `discussion`: `true` and `comment`, the GraphQL id of the comment that the reply answers, if any; for an issue or a pull request that a comment opened or changed, `issueComment`, the id of that comment in the REST API, which a control repository from before it ignores |
| `pager-fix` | 🛠 Start fix | `item`, `repo`, `kind` (`alarm` or `alert`), `entries` with `label` and `url`, `language`. The `url` of a release run that failed names its attempt, such as `…/actions/runs/3/attempts/2`, so that the fix reads the jobs of that attempt and not those of a rerun that still runs |
| `pager-text` | A text that answers no prompt and no [open question of an agent](#questions-and-reports-of-your-agents) | `text`, `message` (its id in the chat), `reply`: the first 1000 characters of the message that the text answers, if any, and `thing`: the thing whose topic the text came from, if any; `language` |

`language` is `LANGUAGE` of the Worker, `en` or `de`: the control repository answers the maintainer in it, the note of a fix and the reason of a job that failed included, while a draft of a reply keeps the language of its issue or pull request.

A text in reply to a message of the pager is about its thing: *merge it*, in reply to the message of a release, names that release. So is a text in the topic of a thing, which carries the thing as `thing`: its `id`, `kind`, `repo` and `state`, the `number` of a contribution or a release and the `version` of a release, `links` to where GitHub shows it (its issue or pull request, or the page of a bundle and its entries, 21 at most) and `text`, its message as the maintainer sees it, in the HTML of Telegram, with what comes from GitHub escaped, 1500 characters at most. The key is `thing`, not `item`: the control workflow runs the jobs of one `item` one at a time, and a text keeps a run of its own. A workflow that doesn't know `thing` passes it over, so either side may deploy first. The pager sends no text of an issue, not even the start that its message quotes: the workflow reads it from GitHub itself, as data. It answers with a `POST` to `/control`:

- the header `X-Pager-Timestamp`, the time in seconds since 1970, which may be five minutes off at most;
- the header `X-Pager-Signature`, `sha256=` and the HMAC with SHA-256, under `CONTROL_SECRET`, of the timestamp, a dot and the body;
- a body of JSON, one of those below.

The body is one of:

- `{"type": "draft", "item": "<id>", "text": "<reply>"}`: the draft of a reply for a contribution, at most 3000 characters, shown as a new message with ✅ Send. Once the maintainer wrote the draft himself, the draft of a job goes into the topic of the thing as a message to read, and his stays;
- `{"type": "note", "item": "<id>", "text": "<note>"}`: a note below a thing, such as the pull request of a fix. The note that ends a job, while the thing is still *fixing* (or a contribution *drafting*), comes in a new message, which notifies, as a failure does; another note edits the message of the thing in place;
- `{"type": "note", "text": "<answer>"}`: a message of its own, such as the answer to free text;
- `{"type": "proposal", "text": "<answer>", "action": "<action>", "target": {"kind": "<kind>", "repo": "<owner/name>", "number": <number>}}`: an answer to free text that proposes one action, as a message of its own with a single ✅ Confirm button;
- `{"type": "failed", "item": "<id>", "text": "<why>"}`: a draft or a fix that didn't come to be, such as when the weekly limit is reached. The thing goes back to the state before its button, with the reason as its note, in a new message, so that the button can run again;
- `{"type": "failed", "item": "<id>", "text": "<why>", "action": "rerun"}`: a fix that made no change and proposes one action of its alarm or alert, such as 🔁 Rerun when the logs show an outage of GitHub or of a download. The thing goes back as above, with the reason as its note, but its message keeps its place, and the answer comes in the thing's topic as a proposal, with a single ✅ Confirm button, which notifies. A thing that doesn't offer the action then, such as an alarm whose entries name no run, comes back as for any failed job. An older pager ignores `action`, so either side may deploy first;
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
| `assistant`, `draft` | `contribution` | the issue, pull request or discussion |
| `fix` | `alarm`, `alert` | none |
| `rerun` | `alarm` | none |
| `later`, `ignore` | any of the four | for a contribution |

✅ Confirm carries the data of the thing's own button, so a press runs the action only while the thing still offers it, as any press does, and then the button goes. A thing that the pager doesn't show, or that doesn't offer the action now, gets the answer without a button. The `action` of a failed fix names no `target`: it is the thing of the job. ✅ Send and ✏️ Edit can't be proposed: they stay with the message of the draft, which shows the text that they post.

```sh
body='{"type":"note","text":"The fix is in #12."}'
stamp=$(date +%s)
signature=$(printf '%s.%s' "$stamp" "$body" | openssl dgst -sha256 -hmac "$PAGER_CONTROL_SECRET" -r | cut -d' ' -f1)
curl -s "$PAGER_URL/control" -H "X-Pager-Timestamp: $stamp" -H "X-Pager-Signature: sha256=$signature" -d "$body"
```

No body makes the pager act: whatever the control repository sends is shown, escaped, and never run, and every action needs the press of a button of the allowlist. The answer goes to the Worker rather than straight to Telegram, as [decision 0003](decisions/0003-the-control-repository-answers-the-worker.md) explains: the token of the bot stays in Cloudflare, and the Worker keeps the state that a draft, a failed job and a proposal need.

## Questions and reports of your agents

The maintainer's own agents, such as an orchestrator that runs on their PC through the night with `gh` signed in as them, ask through the pager instead of leaving a line in a report: a question comes as a thing of its own, in a topic of its own, with its options as buttons, and the agent reads the answer from the private control repository. No secret goes to the PC: `gh` sends the event and reads the answer with the maintainer's own sign-in.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/a-question-of-an-agent.dark.svg">
  <img src="images/diagrams/a-question-of-an-agent.svg" alt="A question of an agent: An agent of Dennis, such as an orchestrator on his PC, sends the event pager-ask with gh to the private control repository, with an id, a question and two to four options. Its workflow takes only an event of Dennis himself, checks it and sends it to the Worker, signed. The pager opens a topic for the question, with one button per option. Dennis presses one, or writes his own answer in the topic, and the GitHub App saves it as answers/id.json on the branch pager-answers of the control repository. The agent reads it there with gh, without a secret of its own, and wait takes only an answer newer than the question. An agent that no longer needs the answer sends pager-withdraw: the buttons go, and the topic says that it took the question back.">
</picture>

An agent sends one of three [repository dispatches](https://docs.github.com/rest/repos/repos#create-a-repository-dispatch-event) to the control repository:

| Event type | Client payload | What the pager shows |
| --- | --- | --- |
| `pager-ask` | `id`, `question`, `options` | A topic *🤔 Decision: …*, with one button per option |
| `pager-withdraw` | `id`, and `reason` if any | The question loses its buttons, and its message says that the agent took it back |
| `pager-report` | `text`, and `title` if any | A topic *🧾 Run: …*, or *🧾 Run* without a title, with the report and no button |

```sh
gh api repos/Dennis-Otto/dennis-otto-pager-control/dispatches --input - <<'JSON'
{"event_type": "pager-ask", "client_payload": {"id": "2026-11-08-merge-order", "question": "Which release goes first?", "options": ["The blueprint", "The pager"]}}
JSON
```

The workflow of the control repository takes only an event that the owner of the repository sent, never one of the GitHub App or of anyone else, checks it as the pager does and sends it on to `/control`, signed as every answer:

- `{"type": "ask", "id": "<id>", "question": "<question>", "options": ["<option>", …]}`: the `id` names the answer, with letters, digits, dots, dashes and underscores, 64 characters at most, starting with a letter or a digit; the `question` has 1000 characters at most; two to four `options`, each different and 64 characters at most, become the buttons, one a row. The same `id` again asks nothing new: an open question stays as it is, and the pager answers 409 for one that is answered already. An answered `id` keeps its file on `pager-answers` for good and can't be asked again, so each question takes a new `id`, with the date or the run in it, such as `2026-11-08-merge-order`: the agent would read the old answer as the choice for its new question. Without the GitHub App on the control repository, the pager answers 503, since it couldn't save the answer;
- `{"type": "withdraw", "id": "<id>", "reason": "<reason>"}`: the agent no longer needs the answer, such as after its wait gave up and it went on without one. An open question loses its buttons, its message says that the agent took it back, with the `reason`, 500 characters at most, below it, and its topic gets ✅; nothing is saved on `pager-answers`. The same `id` again changes nothing, the pager answers 409 for a question that is answered already, whose answer stands for the agent to read, and 404 for one that it doesn't know, never asked or forgotten 30 days after its end. A question taken back keeps its `id` used: asked again, it gets 409;
- `{"type": "report", "text": "<report>", "title": "<title>"}`: the report of a run, its first 3000 characters, with a `title` of 100 characters at most, which the pager leaves out of its store.

A press saves the answer in the control repository, as the GitHub App, with a token for that repository alone and its permission to write the contents, which it has for the dispatches already: the file `answers/<id>.json` on the branch `pager-answers`, which its first answer makes with a commit of its own, without a parent and without the code of the repository, so no workflow runs on it.

```json
{
  "id": "2026-11-08-merge-order",
  "question": "Which release goes first?",
  "options": ["The blueprint", "The pager"],
  "choice": 1,
  "answer": "The pager",
  "answered": "2026-11-08T07:12:03.000Z"
}
```

A text that the maintainer writes in the topic of an open question is its answer in his own words, for when none of the options fits ([decision 0010](decisions/0010-a-text-in-the-topic-of-a-question-answers-it-and-an-agent-may-take-it-back.md)): the pager saves it in the same file, with `choice` `null` and the text as `answer`, so that the agent reads it as it reads a button, and gives the text a 👍. It takes 1000 characters at most; a longer one, and one that GitHub refuses, gets an answer in the topic that says why, and the question stays open. Once a question is answered or taken back, a text in its topic goes to the control repository, as in the topic of any other thing.

```json
{
  "id": "2026-11-08-merge-order",
  "question": "Which release goes first?",
  "options": ["The blueprint", "The pager"],
  "choice": null,
  "answer": "Neither: wait for the release of Paperless.",
  "answered": "2026-11-08T07:14:40.000Z"
}
```

The message then shows the answer, its buttons go, and its topic gets ✅. When GitHub refuses the answer, the button says why and the question stays open, so that a press saves it again. A question takes no ⏰ Later and no ✖ Ignore: an agent waits for it. The agent reads the answer with its own `gh`, which answers 404 until there is one, for an `id` that was never asked before:

```sh
gh api -H "Accept: application/vnd.github.raw+json" "repos/Dennis-Otto/dennis-otto-pager-control/contents/answers/2026-11-08-merge-order.json?ref=pager-answers"
```

The script `scripts/ask.mjs` of the control repository does all of it, as its README describes: it asks, takes a question back, reports and waits for an answer. `ask` prints the time of its question, and `wait` and `answer` with `--since` and that time ignore an older answer, such as that of an earlier question with the same `id`.

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
| Discussion | 💬 demo#31 How do I start? | blue |
| Alarm | 🚨 demo needs you | red |
| Code scanning | 🛡 Code scanning in demo | yellow |
| Release | 📦 demo 1.2.3 | green |
| Reminder | 🔔 Token of Claude | violet |
| Question of an agent | 🤔 Decision: Which release goes first? | violet |
| Report of a run | 🧾 Run: Night run | green |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/a-topic-per-thing.dark.svg">
  <img src="images/diagrams/a-topic-per-thing.svg" alt="A topic per thing: A new thing, such as an alarm, a contribution or a release, opens a topic of its own in the chat, named after its repository and what it is. Its message with the buttons comes first, and its changes edit it there. Its drafts, the answer of Fix, the prompt of Edit, what Later brings back and the answers to what Dennis asks in the topic follow in it; his question goes to the control repository together with the thing. Once the thing is done, its topic gets a check mark in front of its name and stays. Without Threaded Mode, or when Telegram refuses the topic or a message in it, the thing goes on in the main view, as before.">
</picture>

- **Everything about the thing is in its topic.** Its message with the buttons comes first, and its changes edit it in place, as before. A draft, the answer of 🛠 Start fix, a job that failed, the message that ⏰ Later brings back, the prompt of ✏️ Edit and the answers to texts written in the topic follow there.
- **A text in the topic of a thing is about that thing.** It goes to the control repository with the thing as `thing`, as the table above says, so a question such as *why?* needs no more words. A topic that the maintainer opens, and General, have no thing: a text there starts a conversation of its own, as before. A text in the topic of an open [question of an agent](#questions-and-reports-of-your-agents) is its answer instead.
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

## When an event fails

GitHub never delivers an event of a webhook again by itself. When handling one fails, such as when Telegram answers `429` or a `5xx`, or GitHub a `5xx` while the pager reads a pull request, the pager answers `500`, and the schedule takes it from there, in `src/deliveries.ts`:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/when-an-event-fails.dark.svg">
  <img src="images/diagrams/when-an-event-fails.svg" alt="When an event of GitHub fails: GitHub delivers an event to the pager, and handling it fails, such as in an outage of Telegram, so the pager answers 500, or no answer comes in time. GitHub never delivers it again by itself. Every 15 minutes, the schedule reads the deliveries of the app's webhook of the last three hours, and has GitHub deliver the event again, up to three attempts in all and ten events per run. An attempt that passes ends it, and since each signal changes nothing when it comes twice, a redelivery is safe. When the third attempt fails as well, the alarm of the control repository gets one entry, An event of GitHub fails, linked to the recent deliveries on the app's Advanced page. Dennis can deliver it again there, and an attempt that passes takes the entry out.">
</picture>

- **Each run reads the deliveries of the app's webhook** of the last three hours, newest first, with `GET /app/hook/deliveries`: 100 per page and three pages at most. The attempts of an event share its `guid`, and each has an id of its own.
- **An event whose newest attempt failed comes again:** a `5xx` of the pager, or `0`, when no answer came within the ten seconds of GitHub. A `2xx` passed, and a `4xx` is a refusal of the pager, such as of a wrong signature, which it would refuse again. The schedule asks with `POST /app/hook/deliveries/{id}/attempts`, the oldest first, for ten events per run at most and three attempts per event, its first delivery included. It counts only an event whose first delivery is on the pages that it read, so that all its attempts are: an event older than three hours, or on a busy day older than the 300 newest deliveries, gets no more.
- **A second delivery is safe:** each signal leaves the same state when it comes twice, as `test/deliveries.test.ts` checks for every kind of signal. A contribution that is shown already, the same discussion or comment, the same entry of a bundle, a release at the same head and the pictures of the same head change nothing the second time, and no message goes.
- **A late event that a newer one overtook doesn't come again:** a redelivery comes up to 45 minutes late, and its signal would trust a payload that may be stale by then, such as a run that failed before a rerun passed, which would open the alarm again, or a release at a head that has moved since. So an event of a run, a check suite or a check, an alert of code scanning, an issue, a pull request, a discussion or a release doesn't come again once a newer event of the same kind in the same repository passed, which the list shows by its `event` and `repository_id`; the newer one stands, as before the pager asked for any event again. A comment adds to its thing and overtakes nothing, so it always comes again. The rule is coarse: a newer event of another check or another pull request of the repository counts as well, and the failed one is then left out, as it was before.
- **A burst of messages waits a little:** when Telegram answers `429` and asks to wait three seconds at most (`retry_after`), the call waits and tries once more, which keeps a burst of events, also of those that come again, within the limit of the chat.
- **An event whose third attempt fails** is an entry of the alarm of the control repository, the pager's own: *🚨 An event of GitHub fails: pull_request.opened*, linked to the Advanced page of the app, where GitHub shows each delivery with the answer of the pager and offers **Redeliver**. It comes once, by the `guid` of the event, and an attempt that passes later, such as one asked for there, takes it out, which turns the alarm green when it was the last entry. An entry that the alarm shows already, also one that was ignored, stays as it is. An alarm with only such entries offers no 🛠 Start fix, since Claude sees neither the deliveries nor the logs of the Worker.
- **Within the free plan:** a request of a Worker makes 50 calls to the network at most. The deliveries come last in a run and count the calls of the steps before them: the pages and the redeliveries take what is left, and each change of the alarm needs room for ten calls; what doesn't fit comes in the next run. The pager writes nothing to Workers KV for the attempts, since the list of the deliveries counts them, and it signs one JWT of the app for all the calls of seven minutes.

This needs no permission of the app and no secret: the JWT of the app reads and asks for the deliveries of its own webhook.

## State

Workers KV holds one record per thing: its kind, state, repository, the id of its message, the thread and the name of its topic and, for a contribution, the start of its text, the draft, whether it is the maintainer's own, with the ids of the discussion and of the comment that its reply answers for a discussion, and for an issue or a pull request the id of the newest comment of someone else and when one last notified, and for a release the lines of its notes that the message shows; a closed thing expires after 30 days. A link from the thread of a topic to its thing, `topic:<thread>`, lets a text in the topic find it: one write when the topic opens and one when it is renamed, and it expires 30 days after its thing is done. The time of a "Later", and that of a job of the control repository while its thing waits for the answer, are in the metadata of its record, so the schedule finds what is due and what waits too long with one list, the prompt of an edit lives for a day, and one record keeps the texts that wait for their answer, with the time that each went and the thread that it came from, so the schedule reads it once per run and writes it only when a text comes or goes. Each change of a thing is one write, as the free plan of Workers KV wants it. Nothing secret is stored, and the logs name the answers of the APIs only, never a token or the text of an issue.

Workers KV has no compare-and-swap, and a write shows in other places of the network only after a while. So the Worker hands every request that passed its checks of route and method to one Durable Object, `Serial` in `src/serial.ts`, which runs the changes one after another, in one place: two required checks that fail at the same moment end in one message with both, and a ✅ Send pressed twice posts once. The object keeps nothing itself; it is one of SQLite, which the free plan of Workers offers.
