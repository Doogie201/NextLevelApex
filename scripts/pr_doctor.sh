#!/usr/bin/env bash
set -Eeuo pipefail

have(){ command -v "$1" >/dev/null 2>&1; }
die(){ echo "❌ $*" >&2; exit 1; }
say(){ echo "ℹ️  $*"; }
ok(){ echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

have git || die "git not found"
have gh  || die "GitHub CLI (gh) not found; install via brew or https://cli.github.com/"
gh auth status >/dev/null 2>&1 || die "gh not authenticated. Run: gh auth login"

git fetch origin --prune

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || die "Not a git repo")"
cd "$ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ -n "$BRANCH" ] || die "Could not determine current branch"

REPO_SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
say "Repo: $REPO_SLUG"
say "Branch: $BRANCH"

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  warn "You are on $BRANCH. PRs are from feature branches into $BRANCH."
  say "Recent PRs:"
  gh pr list --state all --limit 20 --json number,title,state,headRefName,baseRefName,url \
    -q '.[] | [.number, .state, .headRefName, "->", .baseRefName, .url] | @tsv' | column -t || true
  exit 0
fi

# Does the remote branch exist?
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  ok "Remote branch origin/$BRANCH exists."
else
  warn "Remote branch origin/$BRANCH not found; pushing current branch…"
  git push -u origin "$BRANCH"
  ok "Pushed origin/$BRANCH."
fi

# Is there a PR for this branch (any state)?
PR_JSON="$(gh pr list --state all --json number,state,title,headRefName,baseRefName,url \
           -q ".[] | select(.headRefName==\"$BRANCH\")" | jq -s '.')"
PR_COUNT="$(echo "${PR_JSON:-[]}" | jq 'length')"

if [ "${PR_COUNT:-0}" -gt 0 ]; then
  say "Found PR(s) for $BRANCH:"
  echo "$PR_JSON" | jq -r '.[] | "\(.number)\t\(.state)\t\(.headRefName) -> \(.baseRefName)\t\(.url)"' | column -t
  # Open PR in browser (first match)
  PR_NUM="$(echo "$PR_JSON" | jq -r '.[0].number')"
  say "View PR: $(gh pr view "$PR_NUM" --json url -q .url)"
  exit 0
fi

# No PR found → create one into main
say "No PR found for $BRANCH → creating one into base=main…"
TITLE="${TITLE:-"CI: hardened workflow + coverage upload"}"
BODY="${BODY:-"Created by pr_doctor.sh to sync branch into main."}"
gh pr create --base main --head "$BRANCH" --title "$TITLE" --body "$BODY"

PR_URL="$(gh pr view --json url -q .url)"
ok "PR created: $PR_URL"
