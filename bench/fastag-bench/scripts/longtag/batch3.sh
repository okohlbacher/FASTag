#!/bin/bash
# Batch 3: PXD000001 with its fixed modifications (Methylthio C, TMT6plex K and N-term), build2.
# Started after score_all.sh has finished.
cd /scratch/kohlbach/longtag
rm -rf runs/PXD000001
export FASTAG_BIN=/scratch/kohlbach/longtag/build2/FASTag
R=./run_diag.sh; DS=PXD000001
$R b2_base $DS
FASTAG_DIAG_PVALS=1 $R pvals $DS
FASTAG_DIAG_CPAIR=3 $R cpair3 $DS
FASTAG_DIAG_COMPL_CHARGE=1 $R zc $DS
FASTAG_DIAG_COMPL_CHARGE=1 FASTAG_DIAG_CPAIR=3 $R zc_cpair3 $DS
DEISO=" " $R deiso $DS
MAXP=50 $R maxp50 $DS
MAXP=150 $R maxp150 $DS
MAXP=200 $R maxp200 $DS
PPW=10 $R ppw10 $DS
echo BATCH3_DONE
