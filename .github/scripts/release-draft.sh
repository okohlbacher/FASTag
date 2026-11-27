#!/usr/bin/env bash
# release-draft.sh <tag>
#
# The one release of <tag>: the existing one (published or draft), or a new
# DRAFT. Every job that attaches files calls this first, then uploads with
# `gh release upload <tag>`; ci.yml's release-complete publishes the draft
# once this workflow's files are all there and checked, so no half-attached
# release is ever public.
#
# Race-safe: several jobs (and both workflows) start on the same tag push,
# and GitHub allows any number of DRAFTS with the same tag name (unlike
# published releases). So after creating one this lists again, keeps the
# published release or else the oldest draft, and deletes the other drafts
# -- which, being newer, nobody has uploaded to: every caller keeps the
# same, oldest one. A draft to delete that has assets fails the job
# instead (that is not a race this script made).
#
# Prints the kept release's id. Needs GH_TOKEN (contents: write) and GH_REPO
# or GITHUB_REPOSITORY. RELEASE_DRAFT_ONLY=1 refuses a published release
# (the promote_to dry run's target must be a draft).
set -euo pipefail
TAG="${1:?tag}"
REPO="${GH_REPO:-${GITHUB_REPOSITORY:?GH_REPO or GITHUB_REPOSITORY}}"
list() {
  gh api "repos/$REPO/releases?per_page=100" --paginate \
    --jq ".[] | select(.tag_name == \"$TAG\") | \"\(.id) \(.draft) \(.assets | length)\""
}
rels=$(list)
if [ -z "$rels" ]; then
  gh api -X POST "repos/$REPO/releases" -f tag_name="$TAG" -f name="$TAG" -F draft=true \
    -f body="Automated binary upload; the release notes follow from CHANGELOG.md (job release-notes)." > /dev/null
  rels=$(list)
fi
[ -n "$rels" ] || { echo "::error::no release of $TAG after creating one" >&2; exit 1; }
# Keep: the published one, else the lowest id (the oldest draft).
keep=$(awk '$2 == "false" { print $1; exit }' <<< "$rels")
[ -n "$keep" ] || keep=$(sort -n <<< "$rels" | head -1 | cut -d' ' -f1)
while read -r id draft assets; do
  [ "$id" = "$keep" ] && continue
  if [ "$draft" = true ] && [ "$assets" = 0 ]; then
    gh api -X DELETE "repos/$REPO/releases/$id" > /dev/null 2>&1 || true
    echo "release-draft: removed the duplicate empty draft $id of $TAG (keeping $keep)" >&2
  else
    echo "::error::$TAG has another release ($id, draft $draft, $assets assets) besides $keep" >&2
    exit 1
  fi
done <<< "$rels"
if [ "${RELEASE_DRAFT_ONLY:-0}" = 1 ] && awk -v k="$keep" '$1 == k && $2 == "false"' <<< "$rels" | grep -q .; then
  echo "::error::$TAG is a published release; this run may only write to a draft" >&2
  exit 1
fi
echo "$keep"
