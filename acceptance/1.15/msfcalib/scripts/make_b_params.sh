#!/usr/bin/env bash
# Arm b parameters: `MSFragger --config closed` output with three plumbing edits and nothing else:
#   database_name (set per run), num_threads = 12 (node limit of this test; 32 in msfragger2),
#   labile_fragment_ion_series: the generated line has an empty value followed by an inline comment, which
#   MSFragger 4.4.1 reads as the value and stops on; the line is set to the documented default "b,y"
#   (its own comment: "If left blank, default is b,y"; labile_search_mode stays off, so the key is unused).
# usage: make_b_params.sh <dir>   -> <dir>/closed_fragger.params (generated), <dir>/closed_b.params
set -eu
JAR=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
cd "$1"
java -jar "$JAR" --config closed > config.log 2>&1
sed -e 's|^num_threads = .*|num_threads = 12|' \
    -e 's|^labile_fragment_ion_series = .*|labile_fragment_ion_series = b,y|' closed_fragger.params > closed_b.params
sha256sum closed_fragger.params closed_b.params
diff closed_fragger.params closed_b.params || true
