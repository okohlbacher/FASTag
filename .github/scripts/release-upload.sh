#!/usr/bin/env bash
# release-upload.sh <release id> <file>...
#
# Attaches files to the release with this id (release-draft.sh), by id, not
# by tag name: an asset of the same name is deleted first (the release is a
# draft), then the file goes up through the uploads endpoint, up to 3
# attempts each, and the asset the API then lists must have the file's size
# and sha256 digest. Prints "<sha256>  <name>" per file.
#
# Needs GH_TOKEN (contents: write) and GH_REPO or GITHUB_REPOSITORY.
set -euo pipefail
ID="${1:?release id}"; shift
[[ "$ID" =~ ^[0-9]+$ ]] || { echo "::error::release-upload.sh: '$ID' is not a release id" >&2; exit 2; }
REPO="${GH_REPO:-${GITHUB_REPOSITORY:?GH_REPO or GITHUB_REPOSITORY}}"
API="${GH_UPLOAD_URL:-https://uploads.github.com}"
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
assets() { gh api "repos/$REPO/releases/$ID/assets?per_page=100" --paginate; }
for f in "$@"; do
  [ -f "$f" ] || { echo "::error::release-upload.sh: no file $f" >&2; exit 1; }
  name=$(basename "$f"); want=$(sha "$f"); size=$(wc -c < "$f" | tr -d ' ')
  ok=0
  for i in 1 2 3; do
    # The same name, from an earlier attempt or a failed upload: replaced.
    for old in $(assets | jq -r --arg n "$name" '.[] | select(.name == $n) | .id'); do
      gh api -X DELETE "repos/$REPO/releases/assets/$old" > /dev/null
    done
    if gh api -X POST -H "Content-Type: application/octet-stream" \
         "$API/repos/$REPO/releases/$ID/assets?name=$name" --input "$f" > /dev/null; then
      got=$(assets | jq -r --arg n "$name" '[.[] | select(.name == $n)] | if length == 1 then "\(.[0].size) \(.[0].digest // "")" else "" end')
      if [ "$got" = "$size sha256:$want" ]; then ok=1; break; fi
      echo "::warning::$name: the uploaded asset reads '$got', expected '$size sha256:$want' (attempt $i)" >&2
    else
      echo "::warning::$name: upload attempt $i failed" >&2
    fi
    [ "$i" -lt 3 ] && sleep $((i * ${RELEASE_UPLOAD_SLEEP:-10}))
  done
  [ "$ok" = 1 ] || { echo "::error::$name could not be attached to release $ID" >&2; exit 1; }
  echo "$want  $name"
done
