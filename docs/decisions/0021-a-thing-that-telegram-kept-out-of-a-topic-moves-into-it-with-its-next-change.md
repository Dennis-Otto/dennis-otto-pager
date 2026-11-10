# A thing that Telegram kept out of a topic moves into it with its next change

- Status: accepted
- Date: 2026-11-10

## Context

[Decision 0005](0005-one-topic-per-thing-kept-when-done.md) gives each thing a topic of the chat, and the main view is left for a chat without topics, for a topic that Telegram refuses and for a thing from before topics; [decision 0017](0017-a-topic-that-the-maintainer-deleted-opens-anew-with-the-next-message-of-its-thing.md) opens a new topic for a thing whose topic the maintainer deleted.

On 2026-11-10 the maintainer sent a screenshot of the chat: the notice *"🔴 Docker E2E in paperless-sync" was created*, and below it the message *🔴 Docker E2E fails on main in Dennis-Otto/paperless-sync* with 🔁 Rerun and ✖ Ignore, both in the main view, and no such topic in the bar of threads. The record of the thing in Workers KV had `topic: null`, as had every thing that asked for a new topic since the afternoon of 2026-11-09: two releases, two workflows. The topics from before kept their messages.

The cause is Telegram's: since about 15:00 UTC on 2026-11-09, `createForumTopic` in a private chat answers `400 Bad Request: BOT_TOPIC_WRONG_HOME` for every bot, even a new one, and still leaves its notice *"…" was created* in the chat, with a deleted topic behind it ([tdlib/telegram-bot-api#944](https://github.com/tdlib/telegram-bot-api/issues/944), many reports, still open on 2026-11-10). Topics created before keep working. The pager did what decision 0005 says, and sent the message into the main view; but each new message of a thing without a topic asked for a topic again, so every one of them left another notice that leads nowhere, and an open thing stayed in the main view for good, edited in place, even once Telegram works again.

## Options

1. **As before.** Each new message asks for a topic, and a thing in the main view stays there.
2. **Wait for the topic.** Hold the message back until Telegram opens a topic, and send it then. An outage of Telegram hides every alarm for as long as it lasts, and a failing workflow on `main` is what the pager exists to tell at once.
3. **The main view at once, a pause of new topics, and a move with the next change.** The message goes into the main view when Telegram refuses its topic, as now. Then the pager asks for no new topic for an hour, doubled with each refusal in a row up to four hours, so that an outage leaves a few notices a day instead of one per message. An open thing that waits in the main view moves into a new topic of its own with its next change, once the pause is over and Telegram opens one: its message goes there quietly, as the edit would have, and the one in the main view is deleted. Telegram deletes no message older than 48 hours: such a one is edited to the thing as it is now, without its buttons, which act in the topic. Only a refusal with a Bad Request, as in the outage, pauses new topics; a passing error, such as a 5xx, costs one message in the main view, as before, and a move that fails edits in place, so that the next change tries again.

## Decision

Option 3. `intoNewTopic()` of `src/topics.ts` asks Telegram for a topic only while the chat has topics and no pause holds, which Workers KV keeps under `pause:topics` for a day; a refusal, or a topic that doesn't take its first message, pauses new topics, and the first topic that takes one ends the pause. `moveIntoTopic()` gives `show()` of `src/pager.ts` the move of an open thing with `topic: null`, with `disable_notification`, and `postBelow()` brings such a thing's message into the new topic before the message below it. A done thing, and a thing from before topics, stay in the main view, edited in place: moving one would only open a topic to delete.

This amends decision 0005 and decision 0017 for a topic that Telegram refuses: the main view holds a thing only until Telegram opens topics again and the thing changes.

## Consequences

A thing whose topic Telegram refused shows at once, in the main view, and gets its topic with its next change after the outage, such as the next failed run of its workflow or a new head of its release; a thing that doesn't change again stays in the main view. In an outage, a new thing within the pause costs no call for a topic and leaves no notice; the price is that a topic may open up to four hours after Telegram works again, when the pause ends. The pause is one key in Workers KV, read before each new topic and written once per refusal and once when a topic opens again. No new permission and no new secret.
