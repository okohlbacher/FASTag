#!/usr/bin/env bash
# release-draft.sh create|find <tag>
#
# The one release of <tag>, by id (printed on stdout). Every job that writes
# to a release works on that id (release-upload.sh, gh api .../releases/<id>),
# never on the tag name, which GitHub resolves to any of several drafts.
#
#   create  (ci.yml's job version only: the single creator) the existing
#           release, or a new DRAFT when there is none;
#   find    every other writer: waits for it (RELEASE_WAIT seconds, default
#           0) and never creates one.
#
# Refused, before any mutation:
#   - more than one release with this tag (GitHub allows several drafts with
#     one tag name; nothing is deleted -- an ambiguous state stops the run);
#   - a published release, unless RELEASE_ALLOW_PUBLISHED=1 (an explicit
#     repair: windows.yml's release_tag upload, or the repository variable
#     RELEASE_REPAIR naming the tag); a tag run never writes to a release
#     the public already sees;
#   - with RELEASE_DRAFT_ONLY=1 (promote_to), anything but a draft.
#
# Needs GH_TOKEN (contents: write: drafts are invisible otherwise) and
# GH_REPO or GITHUB_REPOSITORY.
set -euo pipefail
MODE="${1:?create|find}"; TAG="${2:?tag}"
case "$MODE" in create|find) ;; *) echo "::error::release-draft.sh: unknown mode $MODE" >&2; exit 2 ;; esac
REPO="${GH_REPO:-${GITHUB_REPOSITORY:?GH_REPO or GITHUB_REPOSITORY}}"
WAIT=${RELEASE_WAIT:-0}
# id draft assets, one line per release of TAG (the tag compared as a jq
# argument, never spliced into the program).
list() {
  gh api "repos/$REPO/releases?per_page=100" --paginate \
    | jq -r --arg t "$TAG" '.[] | select(.tag_name == $t) | "\(.id) \(.draft) \(.assets | length)"'
}
check() {  # one acceptable release: its id, rc 0; none: rc 1; refused: rc 3
  local rels=$1 n
  n=$(grep -c . <<< "$rels" || true)
  [ "$n" -le 1 ] || { echo "::error::$TAG has $n releases ($(tr '\n' ' ' <<< "$rels")); resolve by hand -- nothing was changed" >&2; return 3; }
  [ "$n" = 1 ] || return 1
  read -r id draft _ <<< "$rels"
  if [ "$draft" != true ]; then
    [ "${RELEASE_DRAFT_ONLY:-0}" != 1 ] || { echo "::error::$TAG is a published release; this run may only write to a draft" >&2; return 3; }
    [ "${RELEASE_ALLOW_PUBLISHED:-0}" = 1 ] || { echo "::error::$TAG is already published; a tag build does not change a public release (repair: repository variable RELEASE_REPAIR=$TAG)" >&2; return 3; }
  fi
  echo "$id"
}
end=$(( $(date +%s) + WAIT ))
while :; do
  rels=$(list)
  rc=0; id=$(check "$rels") || rc=$?
  [ "$rc" = 0 ] && { echo "$id"; exit 0; }
  [ "$rc" = 1 ] || exit 1
  if [ "$MODE" = create ]; then
    [ "${RELEASE_DRAFT_ONLY:-0}" != 1 ] || { echo "::error::$TAG: no draft to write to (promote_to needs an existing draft)" >&2; exit 1; }
    gh api -X POST "repos/$REPO/releases" -f tag_name="$TAG" -f name="$TAG" -F draft=true \
      -f body="Automated binary upload; the release notes follow from CHANGELOG.md (job release-notes)." > /dev/null
    rels=$(list)
    rc=0; id=$(check "$rels") || rc=$?
    [ "$rc" = 0 ] || { [ "$rc" = 1 ] && echo "::error::no release of $TAG after creating one" >&2; exit 1; }
    echo "$id"; exit 0
  fi
  [ "$(date +%s)" -lt "$end" ] || { echo "::error::no release of $TAG after ${WAIT} s (ci.yml's job version creates it)" >&2; exit 1; }
  sleep "${RELEASE_POLL:-15}"
done
