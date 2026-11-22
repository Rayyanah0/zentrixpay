#!/usr/bin/env bash
# Create or update the "Protect main" repository ruleset from
# .github/rulesets/main.json. Requires a GitHub token with admin rights on the
# repository (gh auth login as a maintainer).
#
# Usage: scripts/apply-main-ruleset.sh [owner/repo]
set -euo pipefail

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
file="$(dirname "$0")/../.github/rulesets/main.json"
name="$(jq -r .name "$file")"

existing="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id" | head -n1)"

if [ -n "$existing" ]; then
  gh api --method PUT "repos/$repo/rulesets/$existing" --input "$file" >/dev/null
  echo "Updated ruleset \"$name\" ($existing) on $repo"
else
  gh api --method POST "repos/$repo/rulesets" --input "$file" >/dev/null
  echo "Created ruleset \"$name\" on $repo"
fi
