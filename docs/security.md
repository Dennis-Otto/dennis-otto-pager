# Security design

<!-- The blueprint wrote this page once; from now on it belongs to the project. Keep it true to the software: what it protects, what it trusts, the threats and how the code counters them, and what remains. -->

What Dennis Otto Pager protects, what it trusts and which risks remain. [SECURITY.md](https://github.com/Dennis-Otto/dennis-otto-pager/blob/main/SECURITY.md) says how to report a vulnerability and how to verify a release, and argues why the repository and its releases are safe.

## What you can expect

- Every request from the internet is untrusted input: the Worker checks its method, path and parameters before it acts, and answers anything else with an error.
- The secrets of the Worker live in Cloudflare, set with `npx wrangler secret put`, never in the repository, a log or an answer.
- Cloudflare builds and deploys only the commit of `main` that a release tags, with Workers Builds, and no key of Cloudflare is stored in GitHub.
- The Worker reaches only the bindings of `wrangler.jsonc` and the addresses that its code names.

## Trust boundaries

1. **Internet → Worker.** Every request, its headers and its body are untrusted input.
2. **Worker → bindings and other services.** Only those of `wrangler.jsonc` and the addresses that its code names, with the secrets that Cloudflare keeps.
3. **Repository → Cloudflare.** Workers Builds builds every push to `main`, and only a release goes live.
4. **Control repository → Worker.** The private repository `Dennis-Otto/dennis-otto-pager-control` runs Claude Code and answers at `/control`, signed with `CONTROL_SECRET` over its time and body. What it sends is text: shown, escaped, and never run. It also forwards the questions and reports of the maintainer's own agents, and only those that the owner of the repository sent; the answer to a question is saved there, as a file on a branch of its own, `pager-answers`, which holds no code.

## Threats and countermeasures

| Threat | Countermeasure |
| --- | --- |
| A crafted request reaches code that it shouldn't | The Worker answers only the methods and paths that it knows, and checks every parameter before it acts |
| A secret reaches the repository or a log | Secrets live in Cloudflare, set with `npx wrangler secret put`; `.dev.vars` of `wrangler dev` never reaches git |
| A change goes live without its checks | Only a release deploys, from `main`, which takes no change without every required check |
| A key of Cloudflare leaks from GitHub | None is stored there: Cloudflare builds and deploys with Workers Builds |
| An issue, a comment or a log steers Claude | Claude reads them as data, with tools that only read, behind a firewall; both sides check its answer against the allowlist, and only a press acts |
| A forged answer of the control repository | The Worker takes only a body signed with `CONTROL_SECRET` within five minutes; a proposal gets a button only while its thing offers the action |
| Someone else asks a question in the maintainer's name, or an answer runs | The control repository is private, and its workflow forwards only the events of its owner; an option is a label and an answer is data, a file that the agent reads, and neither acts on GitHub |
| A package that it depends on runs code as it installs | Every install, in the CI, the dev container, Workers Builds and the documentation, is `npm ci --ignore-scripts`; Workers Builds skips its own install with `SKIP_DEPENDENCY_INSTALL` |

## Residual risks

- The Worker is as safe as Cloudflare, its account and the services that it reaches; anyone with access to the account can change the Worker or its secrets.
