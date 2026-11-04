# One topic per thing, kept when it is done

- Status: accepted
- Date: 2026-11-04

## Context

Everything that the pager said was in one long chat: the message of a thing, its drafts, the answers of Claude and the maintainer's questions about it lay between those of every other thing. Telegram's Bot API 9.3 gave the private chat of a bot topics, and 9.4 lets the bot open them with `createForumTopic`, once the maintainer switches on Threaded Mode in @BotFather. The maintainer wants everything about one thing in one place, and the list of topics with their unread counts as the overview. Topics in private chats are new: a rollout of Telegram refused messages into them for a while, in [tdlib/telegram-bot-api#847](https://github.com/tdlib/telegram-bot-api/issues/847), and the first message of a topic opened on a phone can come without its thread.

## Options

1. **One chat, as before,** with replies to the message of a thing. Nothing new can break, but the history of a thing stays spread over the chat.
2. **A topic per message,** one for each change of a thing. Floods the list of topics, and a thing's history is spread again.
3. **A topic per thing,** which its first message opens, and the bundle of a repository's failures or code scanning shares, also when it opens again. Done topics are **deleted** after some days with `deleteForumTopic`: a short list, but the history goes, and the maintainer can't look back at why something failed last week.
4. **A topic per thing, kept when it is done,** with ✅ in front of its name.

## Decision

Option 4. The first message of a thing opens its topic, named after its repository and what it is, with a color per kind; its later messages, a draft, the prompt of ✏️ Edit and the answers to texts written in the topic go into it, and its changes edit its message there, as before. A text in the topic goes to the control repository with the thing as `item`, so a question needs no more words. A done thing, closed or a merged release, gets ✅ in front of its name and keeps its topic: deleting one loses history, and the maintainer deletes one by hand when he wants. The record of the thing keeps the thread and the name of its topic, and a link from the thread to the thing lets a text in the topic find it.

Wherever topics don't work, the pager falls back to what it did before: without Threaded Mode, when Telegram refuses a topic or a message in it, and when a topic is gone. The thing then goes on in the main view, and a topic that took no message is deleted again, so that no empty one stays.

## Consequences

The overview of the chat is the list of topics, and the answer to a question about a thing stays next to it. Each new thing costs a call to `getMe` and one to `createForumTopic`, and one more write to Workers KV for the link of its topic, as does each rename; the free plans take that easily. The contract with the control repository grows by the optional `item` of `pager-text`, which an older workflow passes over, so either side may deploy first. Things from before topics stay in the main view until they close.
