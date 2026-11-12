# A review, new commits and a reopen are news of a contribution

- Status: accepted
- Date: 2026-11-12

## Context

After the first message of a contribution, the pager heard only of the comments in its conversation (`issue_comment`, [decision 0011](0011-a-comment-on-an-issue-or-a-pull-request-edits-its-thing-and-notifies-once.md)). Everything else that a contributor does to move a pull request or an issue on stayed silent: the app had neither `pull_request_review` nor `pull_request_review_comment`, so a reply in the thread of a review comment, the usual place of an answer to a review, never arrived, nor did the review of a third person; and the rules took only `opened` and `closed` of `pull_request` and `issues`, so the fix pushed after a review (`synchronize`), a reopen and a draft made ready for review did nothing. The typical case: the maintainer asks for changes on GitHub, which makes the thing done as replied; the contributor pushes the fix or answers inline, and the pull request waits unseen, while the mails of GitHub are what the pager replaces.

## Options

1. **Leave it to the mails of GitHub.** Nothing to build, but the pager stays blind exactly where a contribution moves on, and the maintainer has to watch two channels.
2. **A message of its own for each such event.** Simple, but a contributor who answers three review comments and pushes the fix makes four messages, and a review with inline comments comes as one event per comment.
3. **News of the contribution, with the rules of decision 0011.** A review and a comment in the code are comments, with their text as the quote; new commits, a reopen and ready for review are an activity, a note on the thing without a word to answer. Both edit an open thing in place and notify once per quiet time, together with the comments, and both open a thing that was done.

## Decision

Option 3. The app subscribes to `pull_request_review` and `pull_request_review_comment`, which its permission *Pull requests* covers. The rules turn a submitted review and a created review comment of someone other than the maintainer or a bot, on a pull request of neither, into the signal `comment` with its `kind`, `review` or `reviewComment`; one of the maintainer is his reply on GitHub, `contribution-done`, as his issue comment is. A review that says nothing itself, with the state *commented*, is left to its comments, since GitHub makes one for each reply in the thread of a review comment and the text is in the comment; an approval or a request for changes without words is news all the same. The ids of reviews, review comments and issue comments come from separate sequences, so a thing keeps the newest id of each kind it saw, and GitHub's second delivery of any of them changes nothing; a record from before keeps its comment as one of the conversation. The draft names the comment by the field of its kind, `issueComment`, `review` or `reviewComment`, which a control repository from before ignores, so the Worker goes first.

`synchronize`, `reopened` and `ready_for_review` of a pull request, and `reopened` of an issue, by someone other than the maintainer or a bot, on one of neither, are the new signal `activity`. It asks for no draft, since it says nothing to answer, and a draft that is shown stays. A push of the maintainer or of a bot, such as a branch brought up to date, means nothing. The thing keeps the time at which GitHub changed the pull request or the issue with each kind of activity, from `updated_at` of the payload, so that the same event twice changes nothing, and the time of its last notice, which mutes the comments and activities of the next `QUIET` together.

## Consequences

The answer to a review reaches the maintainer, as a comment does, and the fix that a contributor pushed after his request for changes opens the thing again with one notice. An app registered before needs the two events ticked in its settings, without a new permission; without them, the activities still come. A review comment and a review are quoted, but a reply still goes below the pull request as a comment of its conversation, and the control repository reads the review or the review comment that the draft names once its template learns the fields `review` and `reviewComment`; until then it drafts from the conversation of the pull request.
