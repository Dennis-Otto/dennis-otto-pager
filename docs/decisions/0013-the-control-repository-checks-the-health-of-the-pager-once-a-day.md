# The control repository checks the health of the pager once a day, and GitHub names the day of its tokens

- Status: accepted
- Date: 2026-11-08

## Context

The pager writes only when something needs its maintainer, never to say that all is well. So a quiet day looks the same whether all is well or the pager is dead: a token of the bot that Telegram no longer takes, a webhook of Telegram that stopped delivering, a schedule that no longer runs, a key of the app that GitHub refuses, or a token of the maintainer that expired all end in silence, and the errors go only to the log of Cloudflare, which nobody reads on a quiet day. The pager reminded of one token only, that of Claude, by the day that `CLAUDE_TOKEN_EXPIRES` names; `GITHUB_USER_TOKEN` of the Worker and `PAGER_FIX_TOKEN` of the control repository are fine-grained tokens, which expire after 30 days unless their owner chose another day, and nothing named their day. GitHub returns the expiry of such a token in the header `github-authentication-token-expiration` of every answer of its API. Workers KV allows 1000 writes a day on the free plan, and the one Durable Object of the pager, `Serial`, has a storage of its own.

## Options

1. **A message when all is well,** such as a daily *the pager lives*. It proves the chat and the bot, but it is the noise that the pager exists to avoid, and its absence is as easy to miss as the silence it replaces.
2. **The pager checks itself and pages.** It can't page through the part that broke: a refused token of the bot, or a schedule that no longer runs, says nothing.
3. **A check from outside, whose failure reaches the maintainer another way.** A scheduled workflow of the private control repository asks the pager, signed, for its health, and fails with an error that names what is wrong. GitHub notifies the maintainer of a failed scheduled run by itself, by mail and on github.com, which works when Telegram or the Worker is the broken part.

For the days of the tokens: a setting per token, as for Claude, which the maintainer must keep in step with each renewal, or the header of GitHub, which needs nothing.

## Decision

Option 3, and the header of GitHub. The body `{"type": "health"}`, signed as every answer of the control repository, gets JSON without a secret: when the schedule last ran to its end, whether Telegram takes the bot (`getMe`) and what `getWebhookInfo` says of the webhook, whether GitHub takes the app (`GET /app`), and what the pager knows of the days of the tokens. The workflow *Health* of the control repository runs once a day, with `permissions: {}` and the secret that signs its answers already, and fails on a schedule older than an hour, a refusal, a webhook without an address or with an error in the last day, or a token that expires within a week.

The schedule asks GitHub about `GITHUB_USER_TOKEN` once a day with `GET /rate_limit`, which counts against no limit of the API, and at once for a new token. The jobs of the control repository read the header for `PAGER_FIX_TOKEN` and send its day as `tokens.fix` with their answers, which an older pager ignores. Each token reminds three weeks before its day, as the token of Claude did, once per token and day, and a token that GitHub refuses with `401` gets a reminder of its own; ✅ Send and 🤖 Assistant again say so on a `401` too.

The time of the schedule's last run and the days of the tokens live in the storage of the Durable Object, not in Workers KV: a write every 15 minutes would take a tenth of the writes of KV a day. To tell a new token from the one it checked, the pager keeps the first 12 characters of the SHA-256 of `GITHUB_USER_TOKEN`, never the token.

## Consequences

A dead pager shows within a day, on a channel that doesn't depend on it, for about a minute of the private repository's Actions minutes a day. A token of GitHub no longer expires without a word, and no setting has to follow a renewal. A new check of the health is a field of the answer and a rule of the workflow *Health*, in both repositories, the pager first. The reminder of the token of Claude still needs `CLAUDE_TOKEN_EXPIRES`, since its token is no token of GitHub. Between two checks, a schedule that stops is seen within a day, not within the hour; the workflow can run more often if that proves too slow.
