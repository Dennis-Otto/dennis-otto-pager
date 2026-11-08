# A discussion that GitHub dealt with is done, and a draft of the maintainer's own stays

- Status: accepted
- Date: 2026-11-08

## Context

[Decision 0006](0006-a-discussion-gets-its-draft-at-once-and-the-reply-of-the-app.md) made a discussion of someone else a thing whose draft comes at once, and whose reply ✅ Send posts as the app. Two cases were left open. The maintainer often answers on GitHub itself, in the browser or its app, and someone may mark an answer, or the discussion may be closed: the thing then stayed open with its buttons, and ✅ Send could still post a second answer. And a text that the maintainer wrote with ✏️ Edit could be lost: a job that still ran when his text came, such as one for a newer comment, replaced it with its own draft, and a new comment of someone else dropped it for a new draft. Other things end with what they are about on GitHub, as the pictures of a pull request do once it closed, and the events *Discussion* and *Discussion comment*, which the app has, tell of each of these.

## Options

1. **Leave both to the maintainer:** ✖ Ignore closes the thing, and he writes his text again. Nothing to build, but a thing that is done on GitHub keeps asking for a press, and a text of his goes without a word.
2. **Close on GitHub's word, and keep the newest draft of the control repository**, offered next to his own with a button of its own. It keeps both texts, but one thing would carry two drafts and two ✅ Send, and every new comment would still cost a run of Claude.
3. **Close on GitHub's word, and let his own text win.** A reply of the maintainer on GitHub, a marked answer, and a discussion closed or deleted make the open thing done, in place, with a note that says why. A draft that he wrote stays the reply: a job's draft that comes later is shown in the topic, to read, and a new comment keeps his text as its draft, without a new job.

## Decision

Option 3. The rules turn `discussion` answered, closed or deleted, and a `discussion_comment` of the maintainer on someone else's discussion, into the signal `discussion-done`, and the pager closes the open thing of that discussion: its buttons go, its topic gets ✅, and its message says why, edited in place, which notifies nobody, since the maintainer was there or GitHub told him. A thing that is closed already stays as it is, and a discussion of the maintainer makes no thing, so its end means nothing.

A text of ✏️ Edit marks the draft as the maintainer's own, and the pager stops waiting for a job of the thing. A draft that such a job sends later goes into the thing's topic as a message without buttons, and his text stays the one that ✅ Send posts. A new comment of someone else shows with his text as its draft and a note that says so, and asks for no new draft: he wrote the reply, so he decides how it changes for the new comment, with ✏️ Edit.

## Consequences

The maintainer can answer a discussion wherever he is, and the pager follows; ✅ Send can no longer post a second answer after his own. The pager answers the draft of a job whose thing was closed meanwhile with 409, as for an ignored thing, which the control repository notes in the log of its run without failing it. A comment after a closed discussion, or after his reply, opens the thing again with a new draft, as after a reply that went, while one after a marked answer stays quiet. A draft of his own costs no further run of Claude for the comments that follow, and a draft of the control repository that he wants instead of his text is one ✏️ Edit with a copy of the text from the topic.
