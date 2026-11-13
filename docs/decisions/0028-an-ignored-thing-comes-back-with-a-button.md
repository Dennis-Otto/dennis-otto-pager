# An ignored thing comes back with a button

- Status: accepted
- Date: 2026-11-13

## Context

✖ Ignore closes a thing with one press, and until now nothing brought it back: an ignored thing had no button left, and its record expired 30 days later. That is wanted for a real Ignore: an ignored issue drops every later comment of its author, an ignored discussion every comment, and an ignored workflow stays quiet until a run of it passes. The gap was the press that was not meant. ✖ Ignore sits in a row with ⏰ Later, two buttons a row, on a phone, so a slip hid an issue and its follow-ups for up to 30 days, or muted a workflow that fails on `main`, and the only repair was to remember it and look at GitHub. The same held for an issue that was ignored on purpose and turned out to matter.

## Options

1. **Ask before ignoring:** a second press to confirm. It costs every real Ignore a press and a changed message, and the issue that turns out to matter later still has no way back.
2. **Ignore later, after a grace period:** keep the thing open for a while and close it then. The schedule would have to write each one again, and the thing would still page in the meantime.
3. **A button that brings it back:** an ignored thing offers ↩️ Bring back as its only button, which opens it again as it was.

## Decision

Option 3. ✖ Ignore keeps the state that it closed the thing in, as `ignoredFrom` of its record, and ↩️ Bring back, the action `restore` of the allowlist, gives it that state again, edited in place: its buttons come back, its topic loses ✅, and its record no longer expires. A state that waits for the end of a job of the control repository or of a rerun, *drafting*, *fixing* or *rerunning*, comes back as the state before it, *new*, *open* or *failing*, since an ignored thing takes no answer of a job and no end of a rerun and would wait for nothing; a draft that the job sends after all is shown, as for any new contribution. A thing ignored before the pager kept its state comes back in the open state of its kind.

What an ignored thing does with later events stays as it is, with one exception: it drops them, but the end of an issue, a pull request or a discussion on GitHub, such as its closing, its merge or a reply of the maintainer there, it keeps as the state to come back in, done, with the reason, quietly; otherwise ↩️ Bring back would reopen a thing that no event ever ends again, and `/open` would list it for good. Otherwise ↩️ Bring back shows the thing as the pager knew it when it was ignored, with the links to GitHub, where the maintainer sees what happened meanwhile.

## Consequences

A slip of the thumb costs one more press, and an ignored issue can come back within the 30 days that its record lives. ✖ Ignore is no longer final, so ↩️ Bring back is the one button that an ignored thing shows; `/open` still leaves ignored things out, since they wait for nobody. A thing that GitHub closed while it was ignored, such as an issue, comes back done, with the reason; what else happened, such as a comment, its next event or a look at GitHub tells.
