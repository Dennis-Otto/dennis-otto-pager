# A topic that the maintainer deleted opens anew with the next message of its thing

- Status: accepted
- Date: 2026-11-08

## Context

[Decision 0005](0005-one-topic-per-thing-kept-when-done.md) gave each thing a topic of the chat and kept the done ones, so that the maintainer deletes one by hand. A topic that was gone made the thing go on in the main view: its next message, and every one after it, landed there, and only a bundle that opened again got a new topic. The messages below the message of a thing, such as the pictures of a release and their album, the notice of a new comment and a draft only to read, went past that rule as well, each with the fallback of Telegram's own `message thread not found`.

On 2026-11-08 the maintainer sent a screenshot: the message *🖼️ 3 pictures look different* of a release pull request of paperless-unified-search and its album lay in the main view, not in a topic, and stayed there after he deleted every topic. He deletes a topic once he is done with it, so for him a deleted topic means *done for me*, and the next event of its thing is new. A thing in the main view is what topics were made to end: the overview of the chat is its list of topics, and a message in the main view belongs to none.

## Options

1. **The main view, as before.** Nothing changes, and every thing whose topic the maintainer deleted goes on in the one long chat that topics replaced, as in the screenshot.
2. **A new topic for the thing's own message alone.** Its next message opens a new topic, but the messages below it, such as its pictures, still fall back to the main view whenever they find the topic gone first.
3. **A new topic for every message of the thing.** Each message of a thing goes into its topic; when the maintainer deleted that, it opens a new topic of the thing, named as the first one, which the thing keeps. A message below the thing's message, which went with the topic, brings the thing's own message, with its buttons, into the new topic first.

## Decision

Option 3. `sendThing()` of `src/topics.ts` sends the thing's own message into its topic, and into a new one when Telegram doesn't find the topic; `postBelow()` sends a message below it, such as the pictures of a release, the notice of a new comment, a draft only to read or a proposal with ✅ Confirm in its topic, into the same topic, and when that is gone, it opens a new one with the thing's own message first, which `render()` and `keyboard()` write as `show()` does, and keeps the thing. Both go through `postInNewTopic()`, so a new topic that Telegram refuses, or that takes no message, still leaves the thing in the main view, as decision 0005 says for a chat without topics. A thing without a topic in a chat with topics asks for one again with its next message: one whose topic Telegram refused, and one that the pager up to 0.7.0 left in the main view as `topic: null` when its topic was gone, such as a release, whose later versions carried that over. A message below such a thing opens its topic only when Telegram gives one, and stays below its message in the main view otherwise, so that a refusal sends no second copy of the thing's message. Only a thing from before topics, which has no `topic` at all, stays in the main view until it closes. An album follows the message above it into its topic, and a comment whose thing's message went anew sends no notice below it, since the new message names the comment and notified already.

This amends the fallback of decision 0005 for a topic that is gone: the main view is left for a chat without topics, for a topic that Telegram refuses and for a thing from before topics.

## Consequences

Everything about a thing is in a topic again, also after the maintainer deleted the old one, and the main view stays empty in a chat with topics. A message below a thing whose topic is gone costs two more calls to Telegram, to open the topic and to send the thing's message, and one more write to Workers KV for the link of the new topic, once per deleted topic; the link of the old topic leads nowhere, since a text in a thread finds its thing only while the thing names that thread. The maintainer gets the thing's message and the one below it as two notifications at once, the price of a thing that is complete in its new topic. A deleted topic that its thing never needs again, such as one of a done thing, stays deleted.
