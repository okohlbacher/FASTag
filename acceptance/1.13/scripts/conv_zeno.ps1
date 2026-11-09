# Retry (staging only, before any FASTag run) for files that failed both routes with
# "unknown instrument type": the same vendor command plus --ignoreUnknownInstrumentError.
$mc = "C:\Program Files\OpenMS-3.5.0-pre-FVdeploy-2026-01-29\share\OpenMS\THIRDPARTY\pwiz-bin\msconvert.exe"
$id = "E7-03.DIA_swath.11"; $in = "C:\e703\vendor\$id\20_AB4_WCP.wiff"; $stem = "20_AB4_WCP"
$o = "C:\e703\out\$id"; $log = "$o\msconvert.log"
"route=vendor+ignoreUnknownInstrumentError" | Add-Content $log
& $mc $in --mzML --zlib --ignoreUnknownInstrumentError --filter "peakPicking vendor msLevel=1-" --outfile "$stem.mzML" -o $o *>> $log
"RC=$LASTEXITCODE" | Add-Content $log
if (Test-Path "$o\$stem.mzML") { "SHA256=" + (Get-FileHash -Algorithm SHA256 "$o\$stem.mzML").Hash.ToLower() | Add-Content $log }
"DONE2" | Add-Content $log
