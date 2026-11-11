#!/bin/bash
# acqcheck2 staging, second pass: after pass 1 ends, retry every file that is not staged (PRIDE refused connections
# at 24 parallel downloads), 10 parallel, hard stop 03:20 CET (20:20 CST) 2026-11-11. No FASTag binary, no truth script.
H=/scratch/kohlbach/b113/acqcheck2/heldout; cd $H
while [ ! -e stage.tsv.done ]; do sleep 20; done
mv stage.tsv stage.pass1.tsv; rm stage.tsv.done
left=$(( $(date -d "2026-11-11 03:20" +%s) - $(date +%s) ))
[ $left -gt 60 ] && timeout $left bash stage.sh manifest.tsv stage.tsv 10 > stage2.out 2>&1
if [ ! -e stage.tsv.done ]; then sort stage.tsv.part > stage.tsv; touch stage.tsv.done; echo cutoff > stage.cutoff; fi
date -Is > stage.final.done
