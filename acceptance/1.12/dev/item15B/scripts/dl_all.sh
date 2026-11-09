#!/bin/bash
cd /scratch/kohlbach/fastag-15b-dev
printf "Trypsin_EThCD_WZ20spd_161224_1.raw 146951935\nChymotrypsin_EThCD_WZ20spd_161224_1.raw 141111015\nTrypsin_EThCD_WZ20spd_161224_2.raw 168548410\nChymotrypsin_EThCD_WZ20spd_161224_2.raw 160634652\nTrypsin_EThCD_WZ20spd_161224_3.raw 202629005\nChymotrypsin_EThCD_WZ20spd_161224_3.raw 173670449\n" | xargs -P 6 -L 1 bash scripts/dl.sh
echo DONE $(date -Is) > PXD060724/STAGE_DONE
