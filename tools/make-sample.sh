#!/bin/sh
# Refresh sample.json (the example poster shown on the landing page) from the GitHub API.
# Usage: tools/make-sample.sh [login]   (needs the gh CLI, or edit to use curl)
set -e
U="${1:-pravin}"
cd "$(dirname "$0")/.."
USER_JSON=$(gh api "users/$U" --jq '{login,name,avatar_url,html_url,created_at,public_repos,type}')
REPOS_JSON=$(gh api --paginate "users/$U/repos?per_page=100&type=owner&sort=pushed" --jq '.[] | {name,html_url,description,language,created_at,pushed_at,stargazers_count,size,fork,archived}' | jq -s '.[:300]')
jq -n --argjson user "$USER_JSON" --argjson repos "$REPOS_JSON" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{fetchedAt: $at, user: $user, repos: $repos}' > sample.json
echo "wrote sample.json for $U ($(jq '.repos|length' sample.json) repos)"
