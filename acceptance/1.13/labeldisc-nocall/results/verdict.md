| criterion | verdict | numbers |
|---|---|---|
| S1 | FAIL | 1 new wrong calls on 70 runs |
| S2 | FAIL | 1 of 15 labelled runs with region_recorded = no called label-free |
| E1 | PASS | 22 of 30 label-free runs without a baseline call are called label-free |
| I1 | PASS | 0 of 33 runs with a baseline call change class |
| overall | FAIL |  |

Runs scored: 70; failed technically and left out: 0 

| truth | runs | baseline right | no call | wrong | candidate right | no call | wrong |
|---|---|---|---|---|---|---|---|
| SILAC | 13 | 9 | 3 | 1 | 9 | 3 | 1 |
| TMT | 11 | 10 | 0 | 1 | 10 | 0 | 1 |
| TMTpro/iTRAQ8 | 5 | 4 | 0 | 1 | 4 | 0 | 1 |
| dimethyl | 6 | 2 | 4 | 0 | 2 | 3 | 1 |
| iTRAQ4 | 2 | 2 | 0 | 0 | 2 | 0 | 0 |
| label-free | 33 | 3 | 30 | 0 | 25 | 8 | 0 |
| all | 70 | 30 | 37 | 3 | 52 | 14 | 4 |

Per run (changed outcome, or no call or wrong with the candidate):

| run | truth | baseline | candidate | basis | reason | region_recorded |
|---|---|---|---|---|---|---|
| PXD020466__JUN2512-S45-A-9_WT_exosome_3 | label-free | no call | no call | site_scan | low_resolution_ms2 | yes |
| PXD010325__PR694_VAL_160416_IgGSTIL1_1to4 | label-free | no call | label-free | absence | - | no |
| PXD055987__220927_OV3_P3_PG_SK_SGe_2022_029_12ul_F_08 | label-free | no call | label-free | absence | - | no |
| PXD009184__TI18 | label-free | no call | label-free | absence | - | no |
| PXD004518__20141217_AFK_GFP_Gehirn2 | label-free | no call | label-free | absence | - | no |
| PXD033411__200310_O1_P8_SG_StM_Eisenack_U1_4 | label-free | no call | label-free | absence | - | no |
| PXD012453__MLN_2 | label-free | no call | label-free | absence | - | no |
| PXD004744__T1-03-II | label-free | no call | label-free | absence | - | no |
| PXD002928__PTSS4113SN15881 | label-free | no call | label-free | absence | - | no |
| PXD013610__cyt | label-free | no call | no call | site_scan | low_resolution_ms2 | yes |
| PXD033693__20180427_BW_06 | label-free | no call | label-free | absence | - | no |
| PXD026462__200728_VE1_PM4_ToK_HIPS_OMV_crude_48_Rep3_F1 | label-free | no call | label-free | absence | - | no |
| PXD008777__20140426_14_V1_ajy_Ecoli_plemo_0_2 | label-free | no call | label-free | absence | - | no |
| PXD026339__OB_JULIANA_PD_TRIPOH2Bv_20180405_05 | label-free | no call | label-free | absence | - | no |
| PXD005624__ACE_0177_XD13 | label-free | no call | label-free | absence | - | no |
| PXD019218__IL15_LOG_WT_5 | label-free | no call | label-free | absence | - | no |
| PXD004678__20110706-Kw-25 | label-free | no call | label-free | absence | - | no |
| PXD015137__Uzorak_22_2 | label-free | no call | label-free | absence | - | no |
| PXD003817__SH-SL_SH_29dpa_2ndrepfraction6 | label-free | no call | label-free | absence | - | no |
| PXD029723__20190401_CO_0860JaRo_R14 | label-free | no call | label-free | absence | - | no |
| PXD019593__Nemo_OBD_M3_20_noprobe_2206190437 | label-free | no call | label-free | absence | - | no |
| PXD005777__OEI17508 | label-free | no call | no call | site_scan | low_resolution_ms2 | no |
| PXD029965__WaEL190923_JAK2_RPV_J4_SCX3_F34148 | label-free | no call | no call | site_scan | low_resolution_ms2 | yes |
| PXD038302__21_S13_iTreg_stimulated_rerun | label-free | no call | no call | site_scan | low_resolution_ms2 | yes |
| PXD012155__20170123_DCs_Phag_F1 | label-free | no call | label-free | absence | - | no |
| PXD045841__Cayla_etal_2023_Alba3APEX2_Late_Biotin_S22_Rep1 | label-free | no call | no call | site_scan | low_resolution_ms2 | yes |
| PXD033426__20210223_F1_PSA_GAK_0374_SF54B | label-free | no call | label-free | absence | - | no |
| PXD008461__igg_01 | label-free | no call | no call | site_scan | low_resolution_ms2 | yes |
| PXD020023__WT1_IP | label-free | no call | no call | site_scan | low_resolution_ms2 | yes |
| PXD011373__C3_T3G1_070916_01_control_rep3 | label-free | no call | label-free | absence | - | no |
| PXD003871__ch_10Aug2014_Ish-Snyth_Del_A_6 | SILAC | no call | no call | site_scan | low_resolution_ms2 | no |
| PXD001278__140129_SILAC_LN_HN_1 | SILAC | no call | no call | site_scan | low_resolution_ms2 | no |
| PXD002444__23052016_SeLi_HF_SAZ_R23_250516_09_rev_010 | SILAC | label-free | label-free | site_scan | - | yes |
| PXD004530__CCC7127A8RW3_H1CCC7127A8RW3-40-516238 | SILAC | no call | no call | site_scan | low_resolution_ms2 | no |
| PXD055201__20170301_CO_0673AnGS_R09R10R11 | dimethyl | no call | no call | site_scan | low_resolution_ms2 | no |
| PXD023260__new_BT474_exp3_b_03 | dimethyl | no call | no call | site_scan | low_resolution_ms2 | no |
| PXD037455__20180226-EPM__DMSO_ES2_2_15B | dimethyl | no call | no call | site_scan | low_resolution_ms2 | no |
| PXD063777__YandongZhang10461950_YDZ_01262023_MMFynepprofiling_2 | dimethyl | no call | label-free | absence | - | no |
| PXD015182__20180816_fusion_GJ_ChenYB_TMT10_L2_4 | TMT | mixed | mixed | site_scan | - | yes |
| PXD067007__B_TMT_F2 | TMTpro/iTRAQ8 | TMT | TMT | reporter_ions | - | yes |
