# #1/#10 DEV regeneration on BinAC2

The species DEV runs that were not finished on data (44 of 47 runs, 2141 arms) run on BinAC2
(bwForCluster, RV bw26G016) as Slurm array tasks, one per run, with the same binary and commands as on data.

- Binary: the RC bundle rc-a117801 copied unchanged (SHA256SUMS sha256 93a1ad6d..., `sha256sum -c` all OK on
  BinAC2); FASTag.bin c4c2ad67fcd9106e474f552267f7cdfefe107f394b268bbc236308b773e4d7f3.
- Runtime: BinAC2 is Rocky 9 (glibc 2.34) and FASTag.bin needs GLIBC_2.38, so it runs inside
  /pfs/10/project/bw26g016/qgate/ubuntu2404.sif (Ubuntu 24.04.5, glibc 2.39-0ubuntu8.9, the same as data).
  OpenMS (/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144, copied whole) and the 134 env libraries of the
  binary's ldd closure (lib_closure.txt) are bound at their data paths; the RC bundle, tax/ and species/grid at
  their data paths too, so every command line equals the one species_dev.py runs on data.
- Plan: dev/scripts/species_dev_plan.py (species_dev.py's arms and argv, nothing run); job:
  dev/scripts/binac2_species_job.sh; results back to data: dev/scripts/binac2_pull.sh.
- Inputs: the DEV list after check_dev_inputs.py (lists/species_dev_check.tsv, PASS rows only); the mzML files
  pushed from data to the BinAC2 workspace directly (no relay through the laptop), sizes checked by the job.
- Equivalence check before the main array: PXD028735_Ecoli_01, finished on data, rerun on BinAC2 for all 50 arms
  (job 6464167): species.tsv SAME 50, DIFF 0 (sha256).
