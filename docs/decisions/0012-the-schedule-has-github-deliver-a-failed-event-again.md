# The schedule has GitHub deliver a failed event again, and every signal may come twice

- Status: accepted
- Date: 2026-11-08

## Context

When the pager fails to handle an event of its GitHub App, such as when Telegram answers `429` or a `5xx`, or GitHub a `5xx` while the pager reads a pull request, it answers `500`. Its comment said that GitHub delivers the event again when asked to, in the settings of the app, but GitHub never redelivers a failed delivery by itself (docs.github.com, *Handling failed webhook deliveries*), and nobody asks: the pager is silent by design, so a missed contribution, an alarm that never came or a release without 🔀 Merge goes unnoticed. The app can list the deliveries of its webhook and ask for one again with its JWT, without a permission or a secret of its own. The free plan of Workers allows 50 calls to the network per request and 1000 writes to Workers KV per day, and the schedule runs every 15 minutes.

## Options

1. **Leave it to the maintainer.** No code, but no one looks at the Advanced page of the app when nothing says that something failed.
2. **Keep the attempts in Workers KV.** A record per event, or one for all, says how often each came again. It is exact also on a busy day, but each redelivery writes, which an outage of an hour turns into hundreds of writes, and the record can disagree with what GitHub did.
3. **Let the list of the deliveries count the attempts.** Each run reads the deliveries of the last three hours, three pages of 100 at most, groups them by `guid` and asks GitHub again for an event whose newest attempt got a `5xx` or no answer, up to three attempts in all and ten events per run, within the calls that the steps before left. An event whose third attempt fails is one entry of the alarm of the control repository, by its guid, linked to the Advanced page of the app, and an attempt that passes later takes it out. The pager writes nothing for the attempts.

## Decision

Option 3. GitHub's list is the one truth about what was delivered and how it ended, so nothing has to agree with it, and the pager writes to Workers KV only when the alarm changes. An event counts only while its first delivery is on the pages that a run read, since only then are all its attempts on them: an event older than three hours, or on a busy day older than the 300 newest deliveries, gets no more attempts, and the schedule never asks again for one whose attempts it can't count. A `4xx` is a refusal of the pager, such as of a wrong signature, which it would refuse again, so it never comes again. The alarm belongs to the control repository, the pager's own repository in its settings, whose app the pager needs for its drafts already. The redeliveries come last in a run, after its other steps, whose calls they count, and before the alarm, so a change of the alarm that doesn't fit waits for the next run, and a failure of Telegram for the alarm stops no redelivery.

Since a redelivery may bring a signal that went through before its answer failed, every signal must leave the same state when it comes twice. Most did already; the same discussion or comment again showed its message anew and asked for a second draft, and a merged release again wrote its record and edited its message, and both now change nothing.

## Consequences

An event that failed in a short outage, of Telegram or of GitHub, comes again by itself within half an hour, and one that keeps failing pages once, where the maintainer sees GitHub's answers and can deliver it again. A new kind of signal, or a change of one, takes its case in `each signal applied twice` of `test/deliveries.test.ts`, which fails until it is safe to deliver twice. The schedule reads one page of the deliveries in each run, about 100 calls of the app's JWT per day, and signs one JWT for seven minutes of calls. On a fleet so busy that 300 deliveries take less than the 15 minutes between two runs, a failed event may be missed; more pages, or the filter `status=failure` of the list together with the passes of the redeliveries, would cover it.
