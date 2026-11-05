### Features

- An alarm whose entry names a run of GitHub Actions that failed on `main`, such as a required check, a release run or an issue of the bot-health bot, offers 🔁 Rerun. It reads the run first and runs its failed jobs again, as "Re-run failed jobs" on GitHub does, without a run of Claude: for a short outage of GitHub, such as a download that answered 504. A run that still runs, or that passed on a retry, stays as it is, and the button says so. While the jobs run again, the entry says *🔁 running again…*; a pass takes the entry out, and the last one turns the alarm ✅. The GitHub App asks for *Actions: Read and write* for it.

### Bug fixes

- A thing whose job of the control repository sent no answer within the hour, after ✍️ Draft a reply or 🛠 Start fix, gets its buttons back, once, as a new message with the note *⌛ No answer from the control repository*, instead of waiting forever.
