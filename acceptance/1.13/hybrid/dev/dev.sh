#!/bin/bash
# DEV of the hybrid arm on PXD060724 (DEV only): Sage truth and the two FASTag arms of three EThcD runs, plus the
# z-ion check (Sage with b,y,c and with b,y on one run).
set -u
A=/scratch/kohlbach/b113/hybrid/acc/acceptance/1.13/hybrid; D=/scratch/kohlbach/b113/hybrid/dev/n
IN=/scratch/kohlbach/fastag-15b-dev/PXD060724; BIN=/scratch/kohlbach/b113/hybrid/frozen/FASTag
T=Trypsin_EThCD_WZ20spd_161224; C=Chymotrypsin_EThCD_WZ20spd_161224
bash $A/scripts/truth.sh $IN/${T}_1.mzML $D/${T}_1 $A/dev/rabbit_trypsin.json &
bash $A/scripts/truth.sh $IN/${T}_2.mzML $D/${T}_2 $A/dev/rabbit_trypsin.json &
bash $A/scripts/truth.sh $IN/${C}_1.mzML $D/${C}_1 $A/dev/rabbit_chymotrypsin.json &
bash $A/scripts/truth.sh $IN/${T}_1.mzML $D/zcheck_byc $A/dev/rabbit_trypsin_byc.json &
bash $A/scripts/truth.sh $IN/${T}_1.mzML $D/zcheck_by $A/dev/rabbit_trypsin_by.json &
wait
for s in ${T}_1 ${T}_2 ${C}_1; do bash $A/scripts/fastag_arms.sh $BIN $IN/$s.mzML $D/$s/run & done
wait
echo DEV_DONE > $D/dev.done
