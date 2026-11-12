# A thing that fails in a run of the schedule costs only itself

- Status: accepted
- Date: 2026-11-12

## Context

A run of the schedule, every 15 minutes, does several steps one after the other: the things that ⏰ Later put aside come back, the things whose job of the control repository didn't answer get their buttons back, the texts without an answer get their 😢, the reports and the tokens get their reminders, the topics that Telegram refused to rename get their names, and the events of GitHub that the pager failed to handle are delivered again (decision 0012). No step stood apart from another: the first message that Telegram refused, such as one that is too long, ended the whole run. The thing was still due in the next run, since its record was written last, so every run failed at the same thing for as long as Telegram refused it, and the events that failed, whose attempts count only for three hours, never came again. The steps before the redeliveries also showed things without looking at the calls that a run has left, so many things due at once could reach the limit of the runtime in the middle of one, and a thing whose new message went out before something after the send failed kept the old message in its record and came again, with live buttons on both messages. The only sign of all this was the time of the last complete run in the answer to the check of the pager's health (decision 0013).

## Options

1. **One `try` around the whole run.** It is what `schedule()` in `src/routes.ts` already does: the log says that the run failed, and nothing else changes.
2. **Each step on its own.** A step that fails stops none after it, but one thing still stops the other things of its step.
3. **Each step and each thing on its own, within the calls of the run.** An error of a thing goes to the log and costs only that thing; the next thing and the next step run; a step shows a thing only while the calls for a whole one are left; and once Telegram shows a new message, its record names it, whatever fails after.

## Decision

Option 3. Each step of `runSchedule()` and each thing of the steps that show things, the things that come back, those whose job didn't answer, the reminders of the reports and of the tokens and the renames of topics, run inside their own `try`: an error goes to the log as *The schedule failed at* the step and the thing, by its id, and the run goes on. The check of `GITHUB_USER_TOKEN` is a thing of its own too, so that a network that breaks during it stops no reminder. A thing that failed changed nothing in its record and is due again in the next run.

A thing that comes again as a new message takes at most eight calls to the network: a message into its topic, a new topic with its check, its message and their fallbacks, the delete of its old message and the new name of the topic. The things that come back, those whose job didn't answer, and the reminders of the tokens show a thing only while eight calls are left, as the workflows that wait for their rerun did already, and the rest waits for the next run. `show()` writes the record once Telegram shows the change, also when what follows, such as the delete of the old message, fails, so that nothing sends the thing again.

A run in which something failed doesn't note its time: it didn't come to its end. It notes the last thing that failed instead, with its time, the step and the thing, and the answer of Telegram or GitHub, which the answer to the check of the health carries as `failure`. A thing that keeps failing makes the schedule older than an hour, which the check of the control repository already reports, and `failure` says why. A run that comes to its end again notes its time and leaves the last failure as it was, with its own time.

## Consequences

One message that Telegram refuses no longer holds up the redeliveries, the reminders or the renames, and no longer pages twice. A thing that keeps failing stays visible: the daily check of the health fails while the schedule doesn't come to its end, and `failure` names the thing, without a word of what it says. The log names the answers of the APIs only, as before. The check of the control repository reports a schedule that is older than an hour, as before; showing `failure` in its own report is a change of the control repository's template.
