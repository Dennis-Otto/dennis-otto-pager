# A new entry of an open bundle notifies, once for a burst

- Status: accepted
- Date: 2026-11-12

## Context

What fails in a repository is bundled into one message, the alarm, and what its security needs into another, the security message ([decision 0002](0002-buttons-of-an-allowlist-act-and-claude-only-proposes.md): "bundles per repository; a new message only for a new thing"). A bundle that opens sends a new message, which notifies. Every entry after that only edited the message in place, and an edit in Telegram notifies nobody. A bundle can stay open for a long time: the issue *Upload the new social preview* was an entry of the alarm of this repository for a day, and only a person can close it. A release that failed in that time, a required check that broke on `main`, a high alert of code scanning or a leaked secret would have reached the message without a sound. Comments on an issue or a pull request had the same problem, and [decision 0011](0011-a-comment-on-an-issue-or-a-pull-request-edits-its-thing-and-notifies-once.md) answered it with a notice below the edited message. On the other side, some entries come in bursts: secret scanning sends one event per alert, a new query of code scanning finds several alerts at once, and a push that breaks `main` can fail a few required checks within a minute.

## Options

1. **Edit in place, and nothing more.** The topic stays tidy, but a new failure in an open bundle stays unseen until the maintainer happens to look.
2. **Show the bundle afresh with each new entry:** a new message, which notifies, and the old one deleted. One message stays, but Telegram deletes no message older than 48 hours, the notification shows the start of the bundle rather than what is new, and each entry of a burst notifies.
3. **Edit in place, and notify once.** The message, edited in place, lists the new entry, and a short message below it in its topic, *🚨 New in this alarm* or *🛡 New in this security message* with the entry and its link, notifies. The new entries of `QUIET` (ten minutes) after the last notice of the bundle, its opening included, come quietly, as the comments of decision 0011 do. A changed entry that is there already, such as a check that fails again or a run that 🔁 **Rerun** started, stays a silent edit.

## Decision

Option 3: a new entry counts as a new thing in the sense of decision 0002, and a burst counts as one, as for comments. The bundle keeps the time of its last notice as `noticed`; a record from before it has none, so its next new entry notifies. A new entry also brings a bundle that ⏰ **Later** put aside back at once, since the new failure needs the maintainer now. When the message of the bundle is gone, such as with a topic that the maintainer deleted, its new message notifies already and lists the entry, so no notice follows. A thing that moves from the main view into its topic moves quietly, so it still gets its notice, and so does a comment on an issue or a pull request that moves this way. GitHub's second delivery of the same event finds the entry as it is and changes nothing.

## Consequences

A failed release, a broken required check, a new high alert or a leaked secret reaches the maintainer with one notification, also while the bundle of its repository is open, and a burst of them costs one. The notice is one more call to Telegram per change of the alarm, which `ALARM_CHANGE` of `src/deliveries.ts` counts. An entry that joins within ten minutes of the last notice relies on that notice: the message lists it, but nothing rings for it.
