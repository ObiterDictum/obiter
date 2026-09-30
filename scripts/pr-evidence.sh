#!/usr/bin/env bash
# Publish before/after media for a pull request and print paste-ready markdown.
#
# GitHub does not allow a personal access token to upload issue/PR attachments
# (the web editor uses a session + CSRF token), so PR evidence cannot be
# attached the way a browser does. Instead the files go on a dedicated orphan
# `evidence` branch of this repository and are referenced through
# raw.githubusercontent.com, which renders in a PR body. The branch carries no
# code, is never merged, and is the only place PR media lives; see PR.md
# ("Before / After"). This exists so a UI change lands with what it looked like
# before and after rather than a prose claim that it works.
#
# Usage:
#   scripts/pr-evidence.sh [--namespace <slug>] <file> [file...]
#
#   --namespace  directory on the evidence branch, default: the current branch
#                name with slashes replaced by hyphens, or pr-<n> / short sha
#                when detached
#
# Images (png, jpg, jpeg, gif, webp, svg, avif) print as ![]() so they render
# inline. Video (mp4, webm, mov) prints as a link: GitHub markdown does not
# inline video, so record a short .gif when the motion matters.
#
# Example:
#   scripts/pr-evidence.sh before-01-search.png after-01-search.png
set -euo pipefail

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
}

namespace=''
files=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --namespace)
      [ "$#" -ge 2 ] || { echo 'error: --namespace requires a value' >&2; exit 2; }
      namespace=$2
      shift 2
      ;;
    --namespace=*)
      namespace=${1#--namespace=}
      shift
      ;;
    -*)
      echo "error: unknown option: $1" >&2
      exit 2
      ;;
    *)
      files+=("$1")
      shift
      ;;
  esac
done

if [ "${#files[@]}" -eq 0 ]; then
  echo 'error: at least one file is required' >&2
  usage >&2
  exit 2
fi

for f in "${files[@]}"; do
  [ -f "$f" ] || { echo "error: not a file: $f" >&2; exit 2; }
done

command -v gh >/dev/null || { echo 'error: gh is required' >&2; exit 1; }
command -v jq >/dev/null || { echo 'error: jq is required' >&2; exit 1; }

if [ -z "$namespace" ]; then
  branch=$(git rev-parse --abbrev-ref HEAD)
  if [ "$branch" != 'HEAD' ]; then
    namespace=${branch//\//-}
  elif pr=$(gh pr view --json number -q .number 2>/dev/null); then
    namespace="pr-$pr"
  else
    namespace=$(git rev-parse --short HEAD)
  fi
fi

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Percent-encode each path segment; the Contents and Trees APIs reject spaces.
uri_path() {
  local path=$1 seg out='' IFS='/'
  for seg in $path; do
    out="$out/$(printf '%s' "$seg" | jq -sRr @uri)"
  done
  printf '%s' "${out#/}"
}

readonly readme='# PR evidence

Media referenced by pull request bodies and verification comments lives here.

This branch holds no code and is never merged. It is written by
`scripts/pr-evidence.sh` in the product repository; each namespace is a branch
or PR slug. Do not edit it by hand.'
readonly branch=evidence

parent=''
base_tree=''
if ref=$(gh api "repos/$repo/git/ref/heads/$branch" --jq '.object.sha' 2>/dev/null); then
  parent=$ref
  base_tree=$(gh api "repos/$repo/git/commits/$ref" --jq '.tree.sha')
fi

entries=$(jq -n --arg p README.md --arg s "$(gh api -X POST "repos/$repo/git/blobs" \
  -f content="$(printf '%s' "$readme" | base64 | tr -d '\n')" -f encoding=base64 --jq .sha)" \
  '[{path:$p,mode:"100644",type:"blob",sha:$s}]')

for f in "${files[@]}"; do
  name=$(basename "$f")
  path=$(uri_path "$namespace/$name")
  blob=$(gh api -X POST "repos/$repo/git/blobs" \
    -f content="$(base64 < "$f" | tr -d '\n')" -f encoding=base64 --jq .sha)
  entries=$(jq -c --arg p "$path" --arg s "$blob" \
    '. + [{path:$p,mode:"100644",type:"blob",sha:$s}]' <<<"$entries")
done

if [ -n "$base_tree" ]; then
  tree=$(jq -n --arg base "$base_tree" --argjson tree "$entries" \
    '{base_tree:$base,tree:$tree}' | gh api -X POST "repos/$repo/git/trees" --input - --jq .sha)
else
  tree=$(jq -n --argjson tree "$entries" '{tree:$tree}' \
    | gh api -X POST "repos/$repo/git/trees" --input - --jq .sha)
fi

if [ -n "$parent" ]; then
  commit=$(jq -n --arg t "$tree" --arg m "PR evidence: $namespace" --arg p "$parent" \
    '{message:$m,tree:$t,parents:[$p]}' | gh api -X POST "repos/$repo/git/commits" --input - --jq .sha)
  gh api -X PATCH "repos/$repo/git/refs/heads/$branch" -f sha="$commit" >/dev/null
else
  commit=$(jq -n --arg t "$tree" --arg m "PR evidence: $namespace" \
    '{message:$m,tree:$t}' | gh api -X POST "repos/$repo/git/commits" --input - --jq .sha)
  gh api -X POST "repos/$repo/git/refs" -f ref="refs/heads/$branch" -f sha="$commit" >/dev/null
fi

echo '## Before / After'
echo
for f in "${files[@]}"; do
  name=$(basename "$f")
  url="https://raw.githubusercontent.com/$repo/$branch/$(uri_path "$namespace/$name")"
  case "${name##*.}" in
    png|PNG|jpg|JPG|jpeg|JPEG|gif|GIF|webp|WEBP|svg|SVG|avif|AVIF) echo "![$name]($url)" ;;
    *) echo "[$name]($url)" ;;
  esac
done
