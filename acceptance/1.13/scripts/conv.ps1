# E7-03 vendor conversions on flash (FASTag 1.13 acceptance, item07 amendment 1). Staging only, no FASTag run.
# One fixed command per file:  msconvert <raw> --mzML --zlib --filter "peakPicking vendor msLevel=1-"
# Fallback, fixed before any run: if that exits non-zero or writes no file, one retry with
#   --filter "peakPicking cwt msLevel=1-"   (recorded in the log as route=cwt)
# A file that fails both stays NOT_STAGED.
$mc = "C:\Program Files\OpenMS-3.5.0-pre-FVdeploy-2026-01-29\share\OpenMS\THIRDPARTY\pwiz-bin\msconvert.exe"
$rows = Import-Csv C:\e703\list.tsv -Delimiter "`t"
$max = 6
foreach ($r in $rows) {
  while ((Get-Job -State Running).Count -ge $max) { Start-Sleep -Seconds 5 }
  Start-Job -ArgumentList $mc, $r.id, $r.input, $r.stem -ScriptBlock {
    param($mc, $id, $in, $stem)
    $o = "C:\e703\out\$id"; New-Item -ItemType Directory -Force -Path $o | Out-Null
    $log = "$o\msconvert.log"
    "route=vendor input=$in" | Set-Content $log
    & $mc $in --mzML --zlib --filter "peakPicking vendor msLevel=1-" --outfile "$stem.mzML" -o $o *>> $log
    $rc = $LASTEXITCODE; "RC=$rc" | Add-Content $log
    if ($rc -ne 0 -or -not (Test-Path "$o\$stem.mzML")) {
      Remove-Item -Force -ErrorAction SilentlyContinue "$o\$stem.mzML"
      "route=cwt" | Add-Content $log
      & $mc $in --mzML --zlib --filter "peakPicking cwt msLevel=1-" --outfile "$stem.mzML" -o $o *>> $log
      "RC=$LASTEXITCODE" | Add-Content $log
    }
    if (Test-Path "$o\$stem.mzML") { "SHA256=" + (Get-FileHash -Algorithm SHA256 "$o\$stem.mzML").Hash.ToLower() | Add-Content $log }
    "DONE" | Add-Content $log
  } | Out-Null
}
Get-Job | Wait-Job | Out-Null
"ALL_DONE" | Set-Content C:\e703\out\ALL_DONE.txt
