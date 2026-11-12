<#
  Installs the Windows desktop app (the NSIS installer) silently into -Dest and
  runs the CLI the app bundles exactly where the installer put it, the way the
  app starts it: no console window (CREATE_NO_WINDOW), OPENMS_DATA_PATH and
  FASTAG_TAXONOMY_DIR pointing into the installed resources, OPENBLAS_NUM_THREADS=1.

    windows_installed_check.ps1 -Installer <setup.exe> -Dest <dir> [-Out <dir>] [-Keep]

  Checks, each with the exit code printed in hex (0xC0000142 is
  STATUS_DLL_INIT_FAILED, 0xC0000135 STATUS_DLL_NOT_FOUND):
    - FASTag.exe --help exits 0 and prints "Version: X.Y.Z";
    - FASTag.exe -write_ini writes the INI the Setup page is built from;
    - a tagging run on the bundled fixture exits 0 and writes tags.
  Uninstalls afterwards unless -Keep. Exits 1 on the first failure.
#>
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Dest,
  [string]$Out = (Join-Path ([IO.Path]::GetTempPath()) 'fastag-installed-check'),
  [switch]$Keep
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$Dest = [IO.Path]::GetFullPath($Dest)

function Fail([string]$msg) { Write-Host "::error::$msg"; exit 1 }

# NSIS: /S silent, /D= the install directory (must be the last argument, unquoted).
$p = Start-Process -FilePath $Installer -ArgumentList '/S', "/D=$Dest" -Wait -PassThru
if ($p.ExitCode -ne 0) { Fail "installer exited $($p.ExitCode)" }
$R = Join-Path $Dest 'resources\fastag'
$exe = Join-Path $R 'bin\FASTag.exe'
if (-not (Test-Path $exe)) { Fail "no bundled CLI at $exe (installed: $((Get-ChildItem $Dest -Name) -join ', '))" }
$dlls = (Get-ChildItem (Join-Path $R 'bin') -Filter *.dll).Count
Write-Host "installed to $Dest; bundled CLI $exe with $dlls DLLs beside it"
Write-Host ("host: {0}, process arch {1}, native {2}" -f [Environment]::OSVersion.VersionString, $env:PROCESSOR_ARCHITECTURE, (Get-CimInstance Win32_Processor | Select-Object -First 1).Name)

function Invoke-Cli([string]$label, [string[]]$argv) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = ($argv | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.WorkingDirectory = $Out
  $psi.EnvironmentVariables['OPENMS_DATA_PATH'] = (Join-Path $R 'share\OpenMS')
  $tax = Join-Path $R 'share\FASTag\taxonomy'
  if (Test-Path (Join-Path $tax 'tax_k7.taxdb')) { $psi.EnvironmentVariables['FASTAG_TAXONOMY_DIR'] = $tax }
  $psi.EnvironmentVariables['OPENBLAS_NUM_THREADS'] = '1'
  $proc = [System.Diagnostics.Process]::Start($psi)
  $so = $proc.StandardOutput.ReadToEndAsync(); $se = $proc.StandardError.ReadToEndAsync()
  if (-not $proc.WaitForExit(600000)) { $proc.Kill(); Fail "$label timed out" }
  $code = $proc.ExitCode
  $text = $so.Result + $se.Result
  Write-Host ("{0}: exit {1} (0x{1:X8})" -f $label, $code)
  if ($code -ne 0) {
    Write-Host $text.Substring(0, [Math]::Min(3000, $text.Length))
    Fail ("{0}: the bundled FASTag.exe exited 0x{1:X8}" -f $label, $code)
  }
  return $text
}

$help = Invoke-Cli 'FASTag.exe --help' @('--help')
$ver = [regex]::Match($help, 'Version:\s*([0-9][^\s,]*)')
if (-not $ver.Success) { Fail '--help printed no "Version:"' }
Write-Host "version $($ver.Groups[1].Value)"

$ini = Join-Path $Out 'defaults.ini'
Invoke-Cli 'FASTag.exe -write_ini' @('-write_ini', $ini) | Out-Null
if (-not (Select-String -Path $ini -Pattern 'fragment_tolerance' -Quiet)) { Fail "-write_ini wrote no parameters to $ini" }

$mz = Join-Path $R 'share\OpenMS\examples\ID\Ecoli_MS2_small.mzML'
$tsv = Join-Path $Out 'installed.tags.tsv'
Invoke-Cli 'FASTag.exe tagging run' @('-in', $mz, '-out', $tsv, '-threads', '2') | Out-Null
$rows = (Get-Content $tsv | Measure-Object -Line).Lines
if ($rows -lt 2) { Fail "the tagging run wrote $rows lines to $tsv" }
Write-Host "tagging run: $rows lines in $tsv"

if (-not $Keep) {
  $u = Join-Path $Dest 'uninstall.exe'
  if (Test-Path $u) { Start-Process -FilePath $u -ArgumentList '/S' -Wait | Out-Null; Write-Host 'uninstalled' }
}
Write-Host 'installed-app check passed'
