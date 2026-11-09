#!/bin/bash
# MSFragger 4.4.1 truth searches of the 6 H1 runs: by + cz on set7, cz on set9 (truth/item15B.tsv 'searches').
# Three lanes, one per parameter file; each lane runs its 3 searches one after the other.
set -u
. "$(dirname "$0")/common.sh"; check_bins
P=$SRC/acceptance/1.12/scorers/truth/item15B
(cd $SRC/acceptance/1.12/scorers && sha256sum -c --ignore-missing SHA256SUMS) > $R/h1/params_check.txt 2>&1 || exit 8
one() { local s=$1 set=$2 rel=$3; local stem=$(basename $rel) D=$R/truth/$M/$rel
  [ -e $D/msfragger_$s.tsv ] && { echo "EXISTS $D/msfragger_$s.tsv"; return 0; }
  mkdir -p $D/$s; cd $D/$s
  ln -sf $S/$rel.mzML $stem.mzML; cp $P/msfragger_${s}_$set.params search.params
  echo "START $(date -u +%FT%TZ) $s $rel" >> $R/h1/times.log
  java -Xmx128G -jar $J search.params $stem.mzML > fragger.log 2>&1; rc=$?
  echo "FRAGGER_RC=$rc" >> fragger.log
  echo "END $(date -u +%FT%TZ) $s $rel FRAGGER_RC=$rc" >> $R/h1/times.log
  [ $rc = 0 ] && [ -s $stem.tsv ] && mv $stem.tsv $D/msfragger_$s.tsv; cp fragger.log $D/fragger_$s.log; rm -f $stem.mzML; }
lane() { local s=$1 set=$2; for x in $RUNS; do [ ${x##*:} = $set ] && one $s $set ${x%%:*}; done; }
lane by set7 & lane cz set7 & lane cz set9 & wait
echo "FRAGGER_DONE $(date -u +%FT%TZ)" >> $R/h1/times.log
