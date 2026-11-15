#!/usr/bin/env bash
# The version in release file names, for ci.yml and windows.yml.
#
#   release_assets.sh version [TAG]
#       Prints the version the release files carry (1.15.0, no leading v):
#       TAG without its v when TAG is given (a v* tag build or windows.yml's
#       release_tag), else project(FASTag VERSION ...) in CMakeLists.txt (a
#       dry run or a branch build). A TAG that disagrees with CMakeLists.txt
#       is an error: the files would be named after a version they are not.
#
#   release_assets.sh check VERSION [NAME ...]
#       Fails when a release asset name does not carry VERSION. Names come
#       from the arguments, or one per line on stdin when none are given.
#       Accepted: FASTag-VERSION-<variant>.<ext> and Debian's
#       fastag-gui_VERSION_<arch>.deb.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)

cmake_version() {
  sed -n 's/^project(FASTag VERSION \([0-9.]*\).*/\1/p' "$here/CMakeLists.txt"
}

case "${1:-}" in
  version)
    want=$(cmake_version)
    [ -n "$want" ] || { echo "::error::no project(FASTag VERSION ...) in CMakeLists.txt" >&2; exit 1; }
    tag="${2:-}"
    if [ -n "$tag" ]; then
      [[ "$tag" == v* ]] || { echo "::error::tag '$tag' does not start with v" >&2; exit 1; }
      [ "${tag#v}" = "$want" ] || {
        echo "::error::tag $tag does not match CMakeLists.txt version $want" >&2; exit 1; }
    fi
    echo "$want"
    ;;
  check)
    v="${2:-}"
    [ -n "$v" ] || { echo "usage: $0 check VERSION [NAME ...]" >&2; exit 2; }
    shift 2
    if [ $# -eq 0 ]; then
      names=()
      while IFS= read -r n; do [ -n "$n" ] && names+=("$n"); done
    else
      names=("$@")
    fi
    [ ${#names[@]} -gt 0 ] || { echo "::error::no asset names to check" >&2; exit 1; }
    bad=0
    for n in "${names[@]}"; do
      case "$n" in
        "FASTag-$v-"?*|"fastag-gui_${v}_"?*.deb) echo "ok       $n" ;;
        *) echo "::error::release asset '$n' does not carry version $v (want FASTag-$v-<variant>.<ext>)"; bad=1 ;;
      esac
    done
    exit $bad
    ;;
  *)
    echo "usage: $0 version [TAG] | check VERSION [NAME ...]" >&2
    exit 2
    ;;
esac
