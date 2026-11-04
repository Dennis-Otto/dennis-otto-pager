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
- **✍️ Draft a reply** and **🛠 Start fix** send the thing to the control repository, whose answer comes back as below. Each is a run of Claude with the maintainer's subscription, which counts against its weekly limit, and the answer says how much it took; a job that fails brings its button back.
- **⏰ Later** brings the thing back as a new message after `LATER_HOURS`; **✖ Ignore** closes it.

## The control repository

The workflow of the private repository `Dennis-Otto/dennis-otto-pager-control` runs Claude Code with the maintainer's own subscription; its README describes its jobs, its safety and its set-up. The pager sends it a [repository dispatch](https://docs.github.com/rest/repos/repos#create-a-repository-dispatch-event), with a token of the app for that repository alone:

| Event type | Sent by | Client payload |
| --- | --- | --- |
| `pager-draft` | ✍️ Draft a reply | `item`, `repo`, `number`, `pull` |
| `pager-fix` | 🛠 Start fix | `item`, `repo`, `kind` (`alarm` or `alert`), `entries` with `label` and `url` |
| `pager-text` | A text that answers no prompt | `text`, `message` (its id in the chat), and `reply`: the first 1000 characters of the message that the text answers, if any |

A text in reply to a message of the pager is about its thing: *merge it*, in reply to the message of a release, names that release. The pager sends no text of an issue: the workflow reads it from GitHub itself, as data. It answers with a `POST` to `/control`:

- the header `X-Pager-Timestamp`, the time in seconds since 1970, which may be five minutes off at most;
- the header `X-Pager-Signature`, `sha256=` and the HMAC with SHA-256, under `CONTROL_SECRET`, of the timestamp, a dot and the body;
- a body of JSON, one of those below.

The body is one of:

- `{"type": "draft", "item": "<id>", "text": "<reply>"}`: the draft of a reply for a contribution, at most 3000 characters, shown as a new message with ✅ Send;
- `{"type": "note", "item": "<id>", "text": "<note>"}`: a note below a thing, such as the pull request of a fix;
- `{"type": "note", "text": "<answer>"}`: a message of its own, such as the answer to free text;
- `{"type": "proposal", "text": "<answer>", "action": "<action>", "target": {"kind": "<kind>", "repo": "<owner/name>", "number": <number>}}`: an answer to free text that proposes one action, as a message of its own with a single ✅ Confirm button;
- `{"type": "failed", "item": "<id>", "text": "<why>"}`: a draft or a fix that didn't come to be, such as when the weekly limit is reached. The thing goes back to the state before its button, with the reason as its note, in a new message, so that the button can run again.

Each body may carry `"usage": {"turns": <number>, "seconds": <number>}`: what the run of Claude took from the weekly limit of the subscription. The message shows it as *🧮 Claude: 4 turns, 52 s, from your weekly limit*.

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

## State

Workers KV holds one record per thing: its kind, state, repository, the id of its message and, for a contribution, the draft; a closed thing expires after 30 days. The time of a "Later" is in the metadata of its record, so the schedule finds what is due with one list, and the prompt of an edit lives for a day. Each change of a thing is one write, as the free plan of Workers KV wants it. Nothing secret is stored, and the logs name the answers of the APIs only, never a token or the text of an issue.

Workers KV has no compare-and-swap, and a write shows in other places of the network only after a while. So the Worker hands every request that passed its checks of route and method to one Durable Object, `Serial` in `src/serial.ts`, which runs the changes one after another, in one place: two required checks that fail at the same moment end in one message with both, and a ✅ Send pressed twice posts once. The object keeps nothing itself; it is one of SQLite, which the free plan of Workers offers.
