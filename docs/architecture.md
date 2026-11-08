# Architecture

[← README](https://github.com/Dennis-Otto/dennis-otto-pager) · [How it works](how-it-works.md) · [Security design](security.md) · [Roadmap](roadmap.md)

How the pager is built: the services around it, the modules of the Worker in `src/`, the path of a request through them and the decisions behind it. [How it works](how-it-works.md) says what the pager does; this page says where in the code it happens.

## Around the Worker

- **Telegram** sends the updates of the bot to `/telegram`, with the secret header of `setWebhook`. The Worker sends, edits and reacts to the messages of the one chat of the maintainer through the Bot API.
- **The GitHub App** sends its events to `/github`, signed with the secret of its webhook. The Worker calls the REST API and, for a reply in a discussion, the GraphQL API, with a token for one repository and the permissions of one call.
- **The private control repository** runs its workflow when the Worker sends it a `repository_dispatch` for a draft, a fix or a free text, and sends its answer to `/control`, signed with `CONTROL_SECRET` over the time and the body.
- **Cloudflare** runs the Worker on workerd, keeps the state in Workers KV (the binding `PAGER`), runs every change in the Durable Object `Serial` (the binding `SERIAL`) and starts the schedule every 15 minutes. Workers Builds deploys the commit that a release tags.

The Worker has no dependency at run time: it uses only the Web APIs of workerd, such as `fetch`, the Web Crypto and the streams that inflate an artifact. The packages of `package.json` are the tools that build, check and test it.

## The path of a request

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/diagrams/the-path-of-a-request.dark.svg">
  <img src="images/diagrams/the-path-of-a-request.svg" alt="The path of a request through the Worker: Telegram calls the Worker at /telegram with a button or a text of the maintainer, the GitHub App at /github with an event, and the control repository at /control with an answer. src/index.ts turns away every other path and method and hands the rest to Serial, the one Durable Object of src/serial.ts, which runs one change at a time, as it does with the run of the schedule every 15 minutes. src/routes.ts first checks where a request comes from, by the secret header of Telegram or the signature of GitHub or of the control repository, and refuses it without a change otherwise. updates.ts, rules.ts, control.ts and schedule.ts decide what it means, and pager.ts and actions.ts apply it: the state of the things in Workers KV, through store.ts, one message per thing in Telegram, through render.ts, texts.ts and telegram.ts, and the action of a button on GitHub, through github.ts.">
</picture>

A request reaches the code of the pager only on one of its three routes and with `POST`; `src/index.ts` answers everything else itself, and `GET /` with `ok` for a check of its health. Each request that passes goes to the one Durable Object, which proves its origin first and then runs its change under one lock, so a button pressed twice and two checks that fail at the same moment each see what the change before them wrote. An update of Telegram that fails is logged and answered with `200`, so that Telegram doesn't send it again and a button doesn't act twice; an event of GitHub that fails is answered with `500`, and the schedule has GitHub deliver it again, three attempts in all, since GitHub never does it by itself ([How it works](how-it-works.md#when-an-event-fails)).

## The modules

| Module | What it owns |
| --- | --- |
| `index.ts` | The handlers of the Worker: the three routes, the methods, the settings that have to be there, and the schedule. |
| `serial.ts` | The one Durable Object, which runs every request and every run of the schedule one after another: Workers KV has no compare-and-swap. |
| `routes.ts` | The check of the origin of each request, and which module serves it. |
| `context.ts` | The settings, the state, the APIs and the texts of a request or a run of the schedule, which the tests make with a simulated network and clock, and the count of its calls to the network. |
| `settings.ts` | The variables of `wrangler.jsonc` and the secrets, and which of them are missing. |
| `updates.ts` | A pressed button or a text of the maintainer; only the chat of `TELEGRAM_CHAT_ID` and its user are served. |
| `rules.ts` | What counts: the one place that decides which event of GitHub needs the maintainer, and as what. [How it works](how-it-works.md) lists the same rules in words. |
| `control.ts` | The answers of the control repository: a draft, a note, a proposal of one action of the allowlist, or the end of a job that failed. |
| `schedule.ts` | The run every 15 minutes: what ⏰ Later put aside, a job or a text whose answer didn't come in time, and the reminder of the token of Claude. |
| `deliveries.ts` | The events of GitHub that failed, which the schedule has GitHub deliver again, three attempts in all, within the 50 calls of a request; an event whose attempts all failed is an entry of the alarm of the control repository. |
| `pager.ts` | What a signal does to the things: one message per thing, edited in place, and a new message, which notifies, only when something new needs the maintainer. |
| `buttons.ts` | The allowlist: which buttons each kind of thing offers in each of its states. |
| `actions.ts` | What each button of the allowlist does; it checks again what it acts on, such as the head of a release pull request. |
| `topics.ts` | One topic of the chat per thing, opened, renamed and marked ✅ when its thing is done. |
| `pictures.ts`, `zip.ts` | The pictures of a visual change from the artifacts of its check, and a reader of ZIP files that checks every length and refuses what it doesn't know. |
| `usage.ts` | The line under an answer of Claude that names the models, the effort and the tokens of its run. |
| `render.ts`, `texts.ts` | The text of each message in the HTML of Telegram, with everything from GitHub escaped, and the catalog of every text in English and German. |
| `telegram.ts` | The Bot API of Telegram, whose address holds the token of the bot, so no error and no log names it. |
| `github.ts` | The REST and GraphQL APIs of GitHub, with the tokens of the app, each made for one repository and the permissions of one call. |
| `store.ts` | The records of the things in Workers KV: as little as possible, nothing secret, and a closed thing expires after 30 days. |
| `crypto.ts` | The signatures of GitHub and of the control repository, the secret header of Telegram, compared in constant time, and the short ids of the things, with Web Crypto. |

Only `telegram.ts`, `github.ts` and `store.ts` talk to the services, and `context.ts` gives them their network, their store and their clock. So a test replaces those three in one place and runs every other module as it runs on Cloudflare.

## Design decisions

The [decisions](decisions/README.md) record each choice that shapes the pager, with its reasons and what it costs:

- **Buttons of an allowlist act, and Claude only proposes** ([0002](decisions/0002-buttons-of-an-allowlist-act-and-claude-only-proposes.md)): nothing that an issue, a pull request or an answer of Claude says runs; an action needs a button that its thing still offers.
- **The control repository answers the Worker** ([0003](decisions/0003-the-control-repository-answers-the-worker.md)): Claude Code runs in a private repository with the maintainer's subscription, and its answer comes back signed.
- **One language per pager, from a catalog** ([0004](decisions/0004-one-language-per-pager-from-a-catalog.md)), and **one topic per thing, kept when it is done** ([0005](decisions/0005-one-topic-per-thing-kept-when-done.md)).
- **A discussion gets its draft at once, and its reply comes from the app** ([0006](decisions/0006-a-discussion-gets-its-draft-at-once-and-the-reply-of-the-app.md)).
- **The pictures of a visual change come from the artifacts of its check** ([0007](decisions/0007-the-pictures-of-a-visual-change-come-from-the-artifacts-of-its-check.md)), and **an agent reads its answer from a branch of the control repository** ([0008](decisions/0008-an-agent-reads-its-answer-from-a-branch-of-the-control-repository.md)).

## Tests

The tests in `test/` run in workerd, the runtime of Cloudflare, through the Vitest plugin of Cloudflare, against a simulated Telegram and GitHub and a clock of their own (`test/helpers.ts`). They cover every line, branch, function and statement of `src/`, which `vitest.config.ts` requires; property tests with fast-check feed random input to the rules, to the escaping of every text and to the parsers of what comes in, such as the data of a button. `bash scripts/check.sh` runs them with the compiler in strict mode, Biome and the other checks of the CI, as [CONTRIBUTING.md](https://github.com/Dennis-Otto/dennis-otto-pager/blob/main/CONTRIBUTING.md) describes.
