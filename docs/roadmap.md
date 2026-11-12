# Roadmap

[← README](https://github.com/Dennis-Otto/repo-pager) · [How it works](how-it-works.md) · [Architecture](architecture.md) · [Security design](security.md)

What the pager intends to do in the next twelve months, until November 2027, and what it will not do. It is a direction, not a promise: what its maintainer misses in practice sets the order. Ideas are welcome as [feature requests](https://github.com/Dennis-Otto/repo-pager/issues/new?template=feature_request.yml) or in the [discussions](https://github.com/Dennis-Otto/repo-pager/discussions).

## The next twelve months

The pager does what it was built for: it tells its maintainer only what needs them, with one message and its buttons per thing. The year is about keeping it that way and making each message worth its notification:

- **What pages, and what doesn't.** The pager looks after the repositories in which its maintainer installed its GitHub App, the [repository blueprint](https://github.com/Dennis-Otto/repo-blueprint) and the projects made from it. An event that should page and doesn't, or one that pages and shouldn't, comes first, with a test in `test/rules.test.ts` that keeps it right.
- **Fewer steps for what repeats.** A next step that the answers of the control repository keep proposing can become a button of the allowlist of its own, as 🔁 **Rerun** did. A button still acts only while its thing offers it, and Claude still only proposes ([decision 0002](decisions/0002-buttons-of-an-allowlist-act-and-claude-only-proposes.md)).
- **Changes of Telegram, GitHub and Cloudflare.** New versions of the Bot API of Telegram, of the webhooks and APIs of GitHub and of the runtime of Cloudflare, with its compatibility date, are taken up once the tests in workerd pass with them.
- **The free plans.** The pager stays within the free plans of Cloudflare and Telegram: one write of Workers KV for each change of a thing, and one run of the schedule every 15 minutes.
- **Fixes and security** come before anything new; [SECURITY.md](https://github.com/Dennis-Otto/repo-pager/blob/main/SECURITY.md) has the times. The update bots and the [repository blueprint](https://github.com/Dennis-Otto/repo-blueprint) keep the tools, the workflows and the checks current.

## Ideas

Not planned for a date yet; a discussion is the place to say that one matters to you.

- **Control of a run of your agents.** An agent asks its decisions through the pager today and reads the answer from a branch of the control repository ([decision 0008](decisions/0008-an-agent-reads-its-answer-from-a-branch-of-the-control-repository.md)), and a run sends its report. The pager could also show a long run as it goes, and pause or stop it with a button.
- **Claude Code Channels.** A channel pushes messages into a running session of Claude Code. The pager could become one, so that a text in the topic of a thing reaches a session on the maintainer's computer directly, and not only the workflow of the control repository.
- **A team of an organization.** The pager watches the repositories of an organization with `OWNERS`, yet only `MAINTAINER_LOGIN` is its maintainer, so what the other members open pages as a contribution. It could take the members of a team as its own, and keep a token for each owner, so that ✅ **Send** acts in the repositories of each.
- **More languages.** The pager speaks English and German, from one catalog per language in `src/texts.ts`. Another language is a catalog with the same keys, placeholders and emojis, which the compiler and `test/texts.test.ts` check ([decision 0004](decisions/0004-one-language-per-pager-from-a-catalog.md)).

## Done

The larger pieces of work of the releases so far; the [changelog](https://github.com/Dennis-Otto/repo-pager/blob/main/CHANGELOG.md) has every change.

- **One message per thing, with buttons** (0.1.0): a contribution from outside, a check or a release that fails on `main`, a code-scanning alert, a green release pull request and the token of Claude before it expires, each acted on with a button of the allowlist.
- **Drafts, fixes and free text in the private control repository** (0.1.0), with Claude Code and the maintainer's own subscription, and the line under each answer that names its model, its effort and its tokens (0.2.0).
- **A topic per thing** (0.3.0), once Threaded Mode is on for the bot, kept with ✅ when the thing is done.
- **🔁 Rerun** (0.4.0) for a run that failed on `main`, which 🛠 **Start fix** also proposes when the logs show an outage of GitHub (0.5.0).
- **Discussions** (0.5.0), with a draft of a reply at once, posted as the app.
- **The pictures of a visual change** (0.5.0), before and after, as one album in the topic of the pull request.
- **Decisions of your agents as buttons** (0.5.0), and the report of a run.

## Not planned

- **More than one person.** The pager serves the private chat of its maintainer and only its user; every other update is dropped without an answer. Another maintainer runs a pager of their own, as [Set up](setup.md) describes.
- **Commands that act.** A text never runs anything on GitHub by itself: an action needs a button of the allowlist, which an answer of Claude can only propose.
- **Claude in the public repository, or a key of the API.** Drafts, fixes and free text run only in the private control repository, with the maintainer's subscription, because the logs of Actions in a public repository are public.
- **Messages that all is well.** The pager writes only when something needs its maintainer; the [dashboard of the blueprint](https://dennis-otto.github.io/repo-blueprint/dashboard/) shows the state of every repository.
- **Another messenger.** The pager is a bot of Telegram, whose Bot API is free and offers the buttons, the topics and the reactions that it needs.
