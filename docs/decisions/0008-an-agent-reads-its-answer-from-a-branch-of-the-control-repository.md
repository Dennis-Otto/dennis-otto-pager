# An agent reads its answer from a branch of the control repository

- Status: accepted, amended by [0010](0010-a-text-in-the-topic-of-a-question-answers-it-and-an-agent-may-take-it-back.md)
- Date: 2026-11-08

## Context

The maintainer's own agents, such as an orchestrator that runs Claude Code on his PC through the night with `gh` signed in as him, need a decision of his now and then: which of two pull requests goes first, whether a risky step may run. Until now they wrote the question into the report of the run, and it waited for the morning. In his Q&A of 2026-11-07 he decided that the pager asks such a question with buttons instead, and that the agent reads his choice without a new secret on the PC.

The way to the pager exists: the private control repository answers the Worker at `/control`, signed with `CONTROL_SECRET` ([decision 0003](0003-the-control-repository-answers-the-worker.md)), and `gh` can send it a repository dispatch with the maintainer's own sign-in. The way back is the question: the Worker holds the answer, and the PC has no secret that the Worker trusts.

## Options

1. **The agent asks the Worker** for the answer, at a route of its own. It would need a secret of the Worker on the PC, or a route that answers anyone who knows an id.
2. **A comment on an issue** of the control repository, written by the GitHub App. The app would need to write issues there, a permission that it doesn't have, and the agent would look for its answer among the comments.
3. **A file on a branch of its own** of the control repository, `answers/<id>.json` on `pager-answers`, written by the GitHub App with its permission to write the contents, which its dispatches already use. The agent reads the file with `gh api`, which answers 404 until there is one.

## Decision

Option 3. The first answer makes the branch with a commit without a parent, whose only file is a README: the branch holds no code of the repository and no workflow, so none runs on a push to it, and `main` stays as it is. Each answer is one commit of the app through the contents API, with the question, its options, the place and the text of the chosen one, and its time. The control repository forwards a question only when its owner sent the event, never one of the app or of anyone else, and the pager takes it only signed, as every other body. A question is a thing of the pager, with a topic of its own and one button per option; the same id again asks nothing new, and an answered one keeps its answer for good, so an id is used once: each question takes a new one, with the date or the run in it, such as `2026-11-08-merge-order`, and the script of the control repository refuses to ask an id that has an answer already.

## Consequences

An agent asks and reads with nothing but `gh`, and the answer stays in the private repository as a record of what was decided, also after the pager forgot the question, 30 days after its answer. A press costs three calls of GitHub, and the first one three more for the branch. An answer is data that the agent reads, never a command that runs: what it does with it is the agent's own, under the rules of its run. A free text written in the topic of a question goes to the control repository as any text in a topic does, not to the agent: an answer beside the options is a follow-up.
