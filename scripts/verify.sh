#!/usr/bin/env bash
# The CI checks that fail most often, run against what this branch changed since its base (default
# origin/main), so a mistake costs a couple of minutes here instead of a CI round. CI still runs everything.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
base=$(git merge-base HEAD "${1:-origin/main}")
changed=$(git diff --name-only --diff-filter=d "$base")
[[ -n $changed ]] || { echo "verify: nothing changed since $base"; exit 0; }

step() { printf '\n== %s\n' "$1"; }

step "Repo checks"
pnpm --silent checks

step "Lint changed files"
xargs pnpm exec biome check --no-errors-on-unmatched --files-ignore-unknown=true <<<"$changed"

if ! grep -qvE '\.md$|^docs/|^\.agents/|^\.claude/' <<<"$changed"; then
  echo "verify: docs only, skipping catalogs, types and tests"
  exit 0
fi

step "Catalogs list every message"
pnpm --silent intl:extract >/dev/null
git diff --exit-code --stat -- packages/i18n/locales || {
  echo "verify: pnpm intl:extract changed the catalogs; commit them."
  exit 1
}

step "Typecheck affected packages"
pnpm --silent db:generate >/dev/null
TURBO_SCM_BASE=$base pnpm --silent check --affected --output-logs=errors-only

step "Tests related to the change"
# A root config or the lockfile makes every test related, and some suites only pass on Linux.
if grep -qE '^(package\.json|pnpm-lock\.yaml|vitest\.config\.[a-z]+|tsconfig[^/]*\.json)$' <<<"$changed"; then
  echo "verify: a root config changed, leaving the full suite to CI"
else
  pnpm exec vitest run --changed "$base" --reporter=dot
fi

printf '\nverify: passed\n'
