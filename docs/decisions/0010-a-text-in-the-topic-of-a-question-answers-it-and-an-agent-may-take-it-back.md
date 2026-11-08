# A text in the topic of a question answers it, and an agent may take its question back

- Status: accepted
- Date: 2026-11-08

## Context

A question of an agent comes with two to four options as buttons ([decision 0008](0008-an-agent-reads-its-answer-from-a-branch-of-the-control-repository.md)). Three gaps showed in its first nights:

- When none of the options fits, such as *neither: wait for the release of Paperless*, the maintainer has no way to say so. A text in the topic of the question went to the control repository as any text in a topic, and Claude answered it, but the agent that waits never heard of it.
- An agent that no longer needs an answer, such as one whose `wait` gave up after an hour and went on with a safe default, couldn't take its question back. Its buttons stayed, and the maintainer answered in the morning a question that nobody read any more.
- `wait` printed any file `answers/<id>.json` that it found, also one that answers an earlier question with the same id, when an agent asked again past the refusal of `ask`, such as with `gh api` alone.

## Options

1. **A button *Other*** that asks for a text in reply to a prompt, as ✏️ Edit does for a draft. It costs a press and a prompt before every own answer, and a fifth button beside four options.
2. **A text in the topic of an open question is its answer.** The topic of a question holds nothing else, so a text there means the question; once it is answered or taken back, a text there is a text about a thing again, which goes to the control repository.
3. **Leave both to the report of the run,** as before the pager asked. The agent would still wait for a question that it no longer needs.

## Decision

Option 2, together with a body to take a question back and a time for `wait`:

- A text in the topic of an open question is saved in the same file as a press, with `choice` `null` and the text as `answer`, so that the agent reads both alike, and its message shows *Your answer, in your own words*. It takes 1000 characters at most, as many as a question. The text gets 👍 once saved; a longer one, and one that GitHub refuses, get an answer in the topic, and the question stays open. A chat without topics has no topic of the question, so a text there stays a text for the control repository.
- The control repository forwards the event `pager-withdraw` of the maintainer as `{"type": "withdraw", "id", "reason"}`. An open question loses its buttons, its message says that the agent took it back, with the reason as its note, and its topic gets ✅. Nothing is saved on `pager-answers`: no one waits any more. An answered question keeps its answer (409), which the agent reads, and an id that the pager doesn't know is 404, both of which the workflow of the control repository logs without failing. A question taken back keeps its id used, as an answered one does.
- `ask` of `scripts/ask.mjs` prints the time of its question, and `wait` and `answer` take it with `--since`, to ignore an answer that is older than the question, with a minute of leeway for the clock of the PC against that of the Worker. `withdraw` checks for an answer first, so that an agent hears that its question was answered after all.

## Consequences

The maintainer answers a question either way, without a button that says *Other*, and an agent reads one shape of answer: a `choice` that is `null` means his own words, which it reads as data, never as a command, as every answer. A question that he wants to ask about the question itself, such as *what does option 2 mean?*, is now its answer: he asks it in General instead, or answers in his own words what he would choose. An agent that gives up takes its question back, so the topics that wait for him are those that still matter. This replaces the last sentence of the consequences of [decision 0008](0008-an-agent-reads-its-answer-from-a-branch-of-the-control-repository.md), which left an answer beside the options to a follow-up.
