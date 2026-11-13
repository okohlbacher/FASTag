# acqcheck3 staging of the SCIEX rows on the Windows workstation flash (download + conversion only; no FASTag,
# no truth script). Input C:\acq3\sciex.tsv (id, file, size, sha1, url, extra = companion "name|bytes|sha1|url").
# Per row: curl.exe over https from PRIDE (at most 3 attempts per pass), PRIDE SHA-1 (or listed size) checked
# for the .wiff and its .wiff.scan; then ProteoWizard msconvert 3.0.22187 (OpenMS 3.5.0 THIRDPARTY build), routes
# in this order until one writes the mzML (as E7-03, PREREG-item07 amendment 1):
#   vendor : --mzML --zlib --filter "peakPicking vendor msLevel=1-"
#   zeno   : the same plus --ignoreUnknownInstrumentError
#   cwt    : --mzML --zlib --filter "peakPicking cwt msLevel=1-"
# Passes repeat (3 jobs at once) until every row is staged, 4 passes, or the hard stop (argument, local time).
# Status per row: C:\acq3\out\<id>\status.txt (fetch=..., route=..., rc=..., mzml=..., sha256=...).
param([string]$Stop)
$mc = "C:\Program Files\OpenMS-3.5.0-pre-FVdeploy-2026-01-29\share\OpenMS\THIRDPARTY\pwiz-bin\msconvert.exe"
$stopAt = [datetime]::ParseExact($Stop, "yyyy-MM-dd HH:mm", $null)
$rows = Import-Csv C:\acq3\sciex.tsv -Delimiter "`t"
function Staged($id) { $s = "C:\acq3\out\$id\status.txt"; (Test-Path $s) -and ((Get-Content $s) -match "^staged=yes$") }
for ($pass = 1; $pass -le 4; $pass++) {
  if ((Get-Date) -ge $stopAt) { break }
  $todo = @($rows | Where-Object { -not (Staged $_.id) })
  if ($todo.Count -eq 0) { break }
  "pass $pass rows $($todo.Count) $(Get-Date -Format s)" | Add-Content C:\acq3\passes.txt
  foreach ($r in $todo) {
    while ((Get-Job -State Running).Count -ge 3) { Start-Sleep -Seconds 5 }
    Start-Job -ArgumentList $mc, $r -ScriptBlock {
      param($mc, $r)
      $id = $r.id; $raw = "C:\acq3\raw\$id"; $o = "C:\acq3\out\$id"
      New-Item -ItemType Directory -Force -Path $raw, $o | Out-Null
      $items = @(@{ name = $r.file; size = $r.size; sha1 = $r.sha1; url = $r.url })
      if ($r.extra) { $e = $r.extra.Split("|"); $items += @{ name = $e[0]; size = $e[1]; sha1 = $e[2]; url = $e[3] } }
      $fetch = "sha1_ok"
      foreach ($it in $items) {
        $p = Join-Path $raw $it.name; $u = $it.url -replace "^ftp://", "https://"
        $good = $false
        for ($a = 1; $a -le 3; $a++) {
          if (Test-Path $p) {
            if ($it.sha1 -and $it.sha1 -ne "-") { $good = ((Get-FileHash -Algorithm SHA1 $p).Hash.ToLower() -eq $it.sha1.ToLower()) }
            else { $good = ((Get-Item $p).Length -eq [int64]$it.size) }
          }
          if ($good) { break }
          if ($a -ge 2) { Remove-Item -Force -ErrorAction SilentlyContinue $p }
          & curl.exe -sS -f -L --retry 3 -C - -o $p $u 2>> "$o\curl.log"
        }
        if (-not $good -and (Test-Path $p)) {
          if ($it.sha1 -and $it.sha1 -ne "-") { $good = ((Get-FileHash -Algorithm SHA1 $p).Hash.ToLower() -eq $it.sha1.ToLower()) }
          else { $good = ((Get-Item $p).Length -eq [int64]$it.size) }
        }
        if (-not $good) { $fetch = "fetch_or_check_FAIL:" + $it.name }
        elseif (-not ($it.sha1 -and $it.sha1 -ne "-") -and $fetch -eq "sha1_ok") { $fetch = "size_ok" }
      }
      $st = @("fetch=$fetch")
      $in = Join-Path $raw $r.file; $stem = [System.IO.Path]::GetFileNameWithoutExtension($r.file)
      $mz = "$o\$stem.mzML"
      if ($fetch -notlike "fetch_or_check_FAIL*") {
        $st += "raw_sha256=" + (Get-FileHash -Algorithm SHA256 $in).Hash.ToLower()
        $routes = @(
          @{ n = "vendor"; a = @("--mzML", "--zlib", "--filter", "peakPicking vendor msLevel=1-") },
          @{ n = "zeno"; a = @("--mzML", "--zlib", "--ignoreUnknownInstrumentError", "--filter", "peakPicking vendor msLevel=1-") },
          @{ n = "cwt"; a = @("--mzML", "--zlib", "--filter", "peakPicking cwt msLevel=1-") })
        foreach ($rt in $routes) {
          if (Test-Path $mz) { break }
          & $mc $in @($rt.a) --outfile "$stem.mzML" -o $o *>> "$o\msconvert.log"
          $rc = $LASTEXITCODE; $st += "route=$($rt.n) rc=$rc"
          if ($rc -ne 0) { Remove-Item -Force -ErrorAction SilentlyContinue $mz }
        }
        if (Test-Path $mz) { $st += "mzml=$stem.mzML"; $st += "sha256=" + (Get-FileHash -Algorithm SHA256 $mz).Hash.ToLower(); $st += "staged=yes" }
        else { $st += "staged=no" }
      } else { $st += "staged=no" }
      $st | Set-Content "$o\status.txt"
    } | Out-Null
  }
  Get-Job | Wait-Job | Out-Null; Get-Job | Remove-Job
}
"ALL_DONE $(Get-Date -Format s)" | Set-Content C:\acq3\ALL_DONE.txt
