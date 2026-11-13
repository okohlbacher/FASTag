#!/bin/bash
# get_db.sh <db dir> : the search databases (PREREG-aspn.md). Human: the file of the 1.13 nontryptic test (sha256 fixed in
# the PREREG). Non-panel organisms: all UniProtKB entries of the UniProt reference proteome, downloaded once at staging.
set -eu
D=$1; mkdir -p $D
cp /scratch/kohlbach/b113/nontryptic/heldout/db/Homo_sapiens.fasta $D/Homo_sapiens.fasta
for x in Mycobacterium_marinum:UP000001190 Trypanosoma_brucei:UP000008524; do
  n=${x%%:*}; up=${x##*:}
  [ -s $D/$n.fasta ] || curl -sS -f -L --retry 5 -o $D/$n.fasta "https://rest.uniprot.org/uniprotkb/stream?format=fasta&query=proteome:$up"
done
( cd $D && sha256sum *.fasta && grep -c '^>' *.fasta )
