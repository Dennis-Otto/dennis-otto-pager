# A comment on an issue or a pull request edits its thing, and notifies once

- Status: accepted
- Date: 2026-11-08

## Context

The pager saw only the first message of an issue or a pull request of someone else: the rules took `issues` and `pull_request` opened and nothing after, and the app had no event of their comments. A contributor who answered the maintainer's question never reached the chat, nor did the second message of a reporter after the issue assistant's answer, such as the four comments on homedarts-for-autodarts#521 and #541 or the one on paperless-sync#84. The other way round, the thing of an issue that was closed on GitHub kept its buttons, and ✅ Send could still post. A discussion follows its comments already ([decision 0006](0006-a-discussion-gets-its-draft-at-once-and-the-reply-of-the-app.md), [decision 0009](0009-a-discussion-that-github-dealt-with-is-done-and-an-own-draft-stays.md)), with a new message and a new draft for each comment, which suits a discussion, whose draft comes by itself. An issue or a pull request gets its draft only when the maintainer asks for one, and a contributor often writes a few comments in a row, so a new message each time would fill its topic with copies of the same thing.

## Options

1. **A new message per comment, as for a discussion.** One rule for both, but each comment notifies and leaves the old message behind, and a few quick comments make as many messages.
2. **Edit the message in place, and nothing more.** The topic stays tidy, but an edit notifies nobody, so the answer to the maintainer's question would still go unseen.
3. **Edit the message in place, and notify once.** An open thing names the newest comment in its message, edited in place, and a short message below it in its topic notifies, once for the comments of ten minutes. A thing whose reply went, or that GitHub dealt with, opens again in its topic as a new message, as a discussion does, and an unknown one comes as new. A draft that the maintainer asked for follows the comment: a job that drafts drafts again once it answered, a draft that is shown is asked for again, and his own text stays. A comment of the maintainer on GitHub, and the issue or the pull request closed, make the thing done, as for a discussion.

## Decision

Option 3. The rules turn `issue_comment` created by someone other than the maintainer or a bot, on an issue or a pull request of someone else, into the signal `comment`, with the id of the comment in the REST API, and a comment of the maintainer there, `issues` closed and `pull_request` closed of someone else into `contribution-done`. An issue or a pull request of the maintainer or of a bot makes no thing, comments and all, as a discussion of the maintainer makes none: GitHub tells its author of each comment itself. The thing keeps the id of the newest comment, so that GitHub's second delivery of the same event changes nothing, and the time of its last notice, which mutes the comments that follow within `QUIET`. The draft of a thing that a comment opened or changed names that comment as `issueComment`: the control repository of today refuses `comment` without `discussion`, but ignores a field that it doesn't know, so the Worker can go first and the control repository reads the field once it is updated.

## Consequences

A reply of a contributor reaches the maintainer with one notice, in the topic of its thing, and the message always shows the newest comment and links to it. A draft costs a run of Claude only when the maintainer asked for one, and again for each comment that comes while that draft is open, at most one job at a time. A thing of an issue or a pull request that GitHub closed loses its buttons, as that of a discussion does, and this works with the events that the app has, while the comments need the event *Issue comment*, which the maintainer ticks in the settings of the app; its permissions *Issues* and *Pull requests* cover it. A comment on an issue or a pull request of the maintainer still reaches him only through GitHub.
