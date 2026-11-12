#!/usr/bin/env bash
# The checks of Repo Pager alone, which scripts/check.sh runs last: the tests of the
# Worker once more with the values of another instance, by
# scripts/another-instance.config.ts. wrangler.jsonc holds the values of the
# maintainer's own instance, and docs/setup.md asks everyone who runs a copy to set
# theirs there; a test that passes only with the values of one instance would fail
# the checks of every other copy, which then couldn't merge a change of its own.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

printf 'The tests with the values of another instance:\n'
if ! npx --no -- vitest run --config scripts/another-instance.config.ts; then
  echo "A test passes only with the values of wrangler.jsonc. Take them from env in the test, as test/index.test.ts does, or set them in the environment of the test."
  exit 1
fi

printf '\nThe test of scripts/register-app.mjs:\n'
if ! node --test test/register-app-script.mjs; then
  echo "scripts/register-app.mjs fails its test, test/register-app-script.mjs, which runs it with stand-ins for npx and for GitHub; the lines above say which part."
  exit 1
fi
