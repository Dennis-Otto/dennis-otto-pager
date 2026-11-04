# One language per pager, from a catalog of texts

- Status: accepted
- Date: 2026-11-04

## Context

The pager spoke English only, and its maintainer wants it in German. Its texts were spread over the code: the messages, the buttons, `/help`, the answers of the buttons and the reminder, and some came from the rules, such as the label of an entry or why a release may not merge yet. The control repository answers in its own words, with Claude.

## Options

1. **A language per message,** from Telegram's `language_code` of the user. The pager serves one maintainer, so this guesses what a setting can say, and the schedule and the webhooks of GitHub, which send most messages, have no user to ask.
2. **One language per pager,** from a variable of `wrangler.jsonc`, with every text in one catalog per language.
3. **Translate on the way out,** with a service or with Claude. Costs a call per message, needs a key or the weekly limit, and its words change from one message to the next.

## Decision

Option 2. `LANGUAGE` in `wrangler.jsonc` chooses `en` or `de`, English when it is empty, and `src/texts.ts` holds every text that goes to the maintainer, one catalog per language with the same keys. A text names its parts in braces, and what fills them, such as a title from GitHub, goes in as it is. The rules stay free of words: they return a key of the catalog with its values, and the pager words it. The logs and the answers of the Worker's routes stay in English, for whoever reads them.

The Worker passes the language with every job to the control repository, and Claude answers the maintainer in it; a draft of a reply keeps the language of its thread, since it goes to someone else.

## Consequences

A new language is one more catalog, which the compiler holds to the keys of English and `test/texts.test.ts` to its placeholders, tags and emojis. A text that the record of a thing keeps, such as a note or the entries of a bundle, keeps the words it was written with after `LANGUAGE` changes; the rest of its message changes with the next update of its thing.
