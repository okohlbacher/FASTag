# c/z• preprocessing: the precursor cut and the ETD species filter

Applies to spectra read as c/z• ions (`-ion_series cz`, or `auto` on ETD/ECD
spectra). Code: `prepare()` in src/FASTagger.cpp.

1. **Precursor cut** (all ion series): peaks above neutral mass + proton +
   1.5 Da are dropped.
2. **ETD species filter** (c/z• only): peaks in the windows of the unreacted
   precursor and each charge-reduced species, (M + c*p)/(c - k) for
   k = 0 .. c-1, from one H below to 3 Da above (neutral), each widened by
   the fragment tolerance, are dropped.
3. **Deisotoping** (`-deisotope`): monoisotopic peaks of 2+/3+ clusters move
   to the 1+ scale.
4. **Precursor cut again** (c/z• only, 1.13, issue T25): a peak that step 3
   moved above the cut of step 1 is dropped, before moved peaks are merged
   into their neighbours. Such a peak cannot be a fragment of the precursor;
   in ETD spectra it is typically the envelope of a precursor species read at
   the wrong charge.

b/y tagging does steps 1 and 3 only, as in 1.12, so its output is unchanged.
Tests: `ion_series_test` section (c2) and the T25 case of
`ion_series_cli_test` (`-dump_spectrum` on a synthetic ETD run).
