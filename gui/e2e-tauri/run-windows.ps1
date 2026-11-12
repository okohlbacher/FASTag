<#
  Run windows.test.mjs against an INSTALLED Windows app (CI: windows.yml job
  installed-app, on x64 and ARM64 runners).

    run-windows.ps1 -App <install dir>\fastag.exe -Out <dir>

  tauri-driver must be on PATH; msedgedriver.exe is fetched for the
  WebView2 runtime this machine has (the versions must match). The app's
  settings and history start empty, as after a fresh install.
#>
param(
  [Parameter(Mandatory = $true)][string]$App,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
$GUI = Split-Path $PSScriptRoot -Parent
$REPO = Split-Path $GUI -Parent
New-Item -ItemType Directory -Force $Out | Out-Null

# msedgedriver matching the installed WebView2 runtime, for this machine's
# architecture.
$key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$wv = (Get-ItemProperty $key -ErrorAction SilentlyContinue).pv
if (-not $wv) { $wv = (Get-ItemProperty ($key -replace 'WOW6432Node\\', '') -ErrorAction SilentlyContinue).pv }
if (-not $wv) { throw 'no WebView2 runtime version in the registry' }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'win64' }
$drv = Join-Path $Out 'edgedriver'
if (-not (Test-Path "$drv\msedgedriver.exe")) {
  New-Item -ItemType Directory -Force $drv | Out-Null
  Invoke-WebRequest "https://msedgedriver.microsoft.com/$wv/edgedriver_$arch.zip" -OutFile "$drv\d.zip"
  Expand-Archive "$drv\d.zip" -DestinationPath $drv -Force
}
Write-Host "WebView2 $wv; msedgedriver $arch"

$env:FASTAG_APP = (Resolve-Path $App).Path
$env:E2E_OUT = $Out
$env:E2E_MZML = Join-Path $REPO 'test\fixtures\Ecoli_MS2_small.mzML'
$env:E2E_MGF = Join-Path $REPO 'test\fixtures\Ecoli_MS2_small.mgf'
$env:E2E_REFUSED = Join-Path $REPO 'test\fixtures\dia_like.mzML'
$env:E2E_VERSION = ([regex]::Match((Get-Content (Join-Path $REPO 'CMakeLists.txt') -Raw), 'project\(FASTag VERSION ([0-9.]+)')).Groups[1].Value
Write-Host "app $env:FASTAG_APP, expecting CLI $env:E2E_VERSION"

# A fresh-install state: no settings or history of an earlier session.
Remove-Item -Recurse -Force "$env:APPDATA\de.openms.fastag", "$env:LOCALAPPDATA\de.openms.fastag" -ErrorAction SilentlyContinue

$log = Join-Path $Out 'tauri-driver.log'
# msedgedriver through a wrapper that adds its verbose log (Out\msedgedriver.log).
$wrap = Join-Path $drv 'msedgedriver-logged.cmd'
('@"%~dp0msedgedriver.exe" --verbose --log-path="' + $Out + '\msedgedriver.log" %*') | Set-Content -Encoding ascii $wrap
$d = Start-Process tauri-driver -ArgumentList '--port', '4444', '--native-driver', $wrap -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError "$log.err"
try {
  $up = $false
  for ($i = 0; $i -lt 100 -and -not $up; $i++) {
    try { Invoke-RestMethod http://127.0.0.1:4444/status | Out-Null; $up = $true } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $up) { Get-Content $log, "$log.err" -ErrorAction SilentlyContinue; throw 'tauri-driver did not come up' }
  Push-Location $GUI
  node --test --test-concurrency=1 --test-reporter=spec e2e-tauri/windows.test.mjs
  $code = $LASTEXITCODE
  Pop-Location
} finally {
  Stop-Process -Id $d.Id -Force -ErrorAction SilentlyContinue
  Get-Process msedgedriver -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
exit $code
