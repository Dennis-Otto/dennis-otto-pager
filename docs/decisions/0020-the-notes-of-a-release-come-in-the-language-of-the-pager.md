# The notes of a release come in the language of the pager

- Status: accepted
- Date: 2026-11-10

## Context

A release message shows the notes of its pull request, so that the maintainer knows what 🔀 **Merge** publishes. The repositories write their changelogs in English, and GitHub keeps them so. On 2026-11-10 the maintainer, whose pager speaks German, sent a screenshot of the message of the release 1.16.0 of repo-blueprint and asked why its summary wasn't German: *📦 Release 1.16.0 von …* and *✅ Veröffentlicht* were German, but the headings *Features* and *Bug fixes* and every item between them were English, since the pager took them from the pull request as they are.

The same screenshot showed a second fault: the topic of that message was still called *📦 repo-blueprint 1.15.1*. A new version of a release keeps the topic of the one that it replaces and renames it, and a done release gets ✅ in front of it. A rename that Telegram refused kept the old name until the next change of the thing, and a published release changes no more.

## Options

1. **English notes, as before.** Correct, but a German pager shows a message of two languages.
2. **The headings alone in the language of the pager.** Deterministic and free, but the items, which are most of the message, stay English.
3. **The headings from the catalog, and the items translated by the control repository.** The control repository runs Claude with the maintainer's subscription already, for drafts and fixes; it translates the items as a job of its own, and the pager edits the message in place once they come.
4. **A translation service, or an API key of Claude, in the Worker.** Quick, but a new secret and a bill of its own; the maintainer decided that the pager works with his subscription only, never with an API key.

## Decision

Option 3. `src/translations.ts` words the headings of the kinds of change, those of release-please, of the blueprint and of Keep a Changelog, from the catalog of the pager, such as *Neue Funktionen* for *Features*, and keeps one that names no kind as it is. For the items, the pager sends the event `pager-translate` to the control repository once per notes of a release, after its message went out in English: the words of each item and text, without their scope such as `deps:`, which stays as it is, and `of`, a key of those notes. The control repository answers with the body `translation`, one line per line it got, which edits the message in place and notifies no one. The record of the release keeps the translation, so a later change of the message, such as *merged*, asks nothing again; notes that change ask anew.

The pager trusts that answer no further than any other of the control repository: a translated line that lost a reference such as #791, or a name of code such as `anchore/syft` or `v1.56.0`, that says nothing or is too long keeps its English, and an answer with another number of lines, or one too long in all, changes nothing. A failed or a slow translation leaves the English, and a pager in English asks for nothing.

A rename of a topic that Telegram refuses marks the thing with the time of the refusal, in the metadata of its record, also for a done thing, and the schedule tries it again every 15 minutes, five topics per run at most, for a day; then the topic keeps its name, and the log says so.

## Consequences

A German pager shows a release in German, a minute after its message, without a second notification. Each release costs one short run of the control repository, on the weekly limit of the maintainer's subscription, and the event goes only when a release pull request has items. The notes go to the control repository, as they already did with a text in the topic of a release; they come from the maintainer's own repositories, and Claude only translates them. The control repository needs the job for `pager-translate`, which comes with the template ([decision 0019](0019-the-control-repository-comes-from-a-public-template-which-every-copy-follows.md)); until a copy has it, the event finds no workflow, and the notes stay English. A topic whose rename Telegram refused gets its name within 15 minutes once Telegram takes it again, at the cost of one read of Workers KV and one call to Telegram per run while it waits, and one write when it is done.
