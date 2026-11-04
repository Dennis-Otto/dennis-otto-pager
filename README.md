# Dennis Otto Pager

[![CI](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml/badge.svg)](https://github.com/Dennis-Otto/dennis-otto-pager/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Dennis-Otto/dennis-otto-pager/badge)](https://scorecard.dev/viewer/?uri=github.com/Dennis-Otto/dennis-otto-pager)
[![REUSE](https://api.reuse.software/badge/github.com/Dennis-Otto/dennis-otto-pager)](https://api.reuse.software/info/github.com/Dennis-Otto/dennis-otto-pager)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Documentation](https://img.shields.io/badge/docs-website-526cfe?logo=materialformkdocs&logoColor=white)](https://dennis-otto.github.io/dennis-otto-pager/)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%99%A5-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/Dennis-Otto)

A Telegram bot on a Cloudflare Worker that tells its maintainer only what needs them in their GitHub repositories, and acts on it with a button.

The documentation is on the [website](https://dennis-otto.github.io/dennis-otto-pager/).

<sub>💛 If Dennis Otto Pager is useful to you, you can [support its development](https://github.com/sponsors/Dennis-Otto).</sub>

## Installation

**Dennis Otto Pager** runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/): Cloudflare builds it from this repository and deploys each release, without a key of Cloudflare in GitHub; [docs/releases.md](docs/releases.md) says how to connect it once and how a release goes live.

To run it on your machine, at <http://localhost:8787>:

```sh
npm ci --ignore-scripts
npm run dev
```

## Development

Every change goes through a pull request whose title follows [Conventional Commits](https://www.conventionalcommits.org/), with commits that are signed off (`git commit -s`) and signed (`git commit -S`). The checks of the CI run locally with

```sh
bash scripts/check.sh
```

[CONTRIBUTING.md](CONTRIBUTING.md) explains the set-up and the rules.

## Releases

The release bot keeps a pull request for the next release open, with the version and the changelog from the merged pull requests. Merging it publishes the release, with its SBOM and a signed provenance; [CHANGELOG.md](CHANGELOG.md) lists every change.

## Support and security

Questions and problems: see [SUPPORT.md](SUPPORT.md). Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## License

MIT; see [LICENSE](LICENSE). Every file names its license in the machine-readable form of [REUSE](https://reuse.software).
