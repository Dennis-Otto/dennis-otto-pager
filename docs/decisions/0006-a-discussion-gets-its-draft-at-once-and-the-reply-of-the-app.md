# A discussion gets its draft at once, and its reply comes from the app

- Status: accepted
- Date: 2026-11-07

## Context

Questions about the repositories come more and more as GitHub Discussions, which the pager didn't see: its rules read issues and pull requests only. On 2026-11-07 the maintainer gave the GitHub App the permission *Discussions: Read and write* and the events *Discussion* and *Discussion comment*, and decided how a discussion should page him: as a thing with its own topic, like a contribution from outside, with a draft of a reply in his voice and the buttons ✅ Send, ✏️ Edit and ✖ Ignore. Discussions live in the GraphQL API of GitHub, whose `addDiscussionComment` posts a comment on a discussion or a reply in the thread of one of its comments, and GitHub nests replies one level only. A conversation in a discussion goes on: the person who asked answers the reply, and someone else joins.

## Options

1. **A discussion as an issue,** with ✍️ Draft a reply and ✅ Send in the maintainer's name, through `GITHUB_USER_TOKEN`. The same buttons as an issue, but the fine-grained token would need the discussions of every repository, and a draft costs one more press.
2. **A thing per comment,** each with its own topic. Simple, but a conversation spreads over as many topics as it has comments.
3. **A thing per discussion, its draft at once and its reply from the app.** The newest message of someone else is the one that the reply answers; the app posts it with a token for `discussions: write` of that one repository.

## Decision

Option 3. A discussion is one thing, keyed by its number, which GitHub counts together with those of issues and pull requests, so it stays in one topic with its history. Its draft is asked for as it comes, since its buttons only send, edit or ignore one; the draft of a comment goes into the thread of that comment, which for a reply is that of its parent. A new comment of someone else makes itself the message to answer, with a new draft: an open thing gets a new message, which replaces the old one, and a thing whose reply went opens again in its topic, where the old message stays. An ignored discussion stays ignored, until its record expires 30 days later. A discussion of the maintainer makes no thing, nor do the comments on it, since GitHub tells its author of each comment itself, and neither does a discussion of Q&A whose answer was chosen.

The app posts the reply rather than the maintainer: its token is made for one repository and one call, as every token of the app is, and the maintainer's own token stays with the two things that need his name. The draft says so, and so does the note of a reply that went.

## Consequences

The maintainer answers a discussion with one press, and its replies show as those of the app, `dennis-otto-pager[bot]`, which the rules pass over when they come back as comments. Each discussion and each comment of someone else costs a run of Claude for its draft, which counts against the weekly limit, so ✖ Ignore matters more for a busy discussion. The contract with the control repository grows by `discussion` and `comment` of `pager-draft`, which its workflow reads with GraphQL; a workflow before that reads the number as an issue, finds none and fails the job, which brings ✍️ Draft a reply back, so either side may deploy first. An app registered before has to ask for the permission and the two events, and each installation has to accept them.
