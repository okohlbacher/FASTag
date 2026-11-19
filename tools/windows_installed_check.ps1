<#
  Installs the Windows desktop app (the NSIS installer) silently for -Scope
  (AllUsers: %ProgramFiles%\FASTag, needs an elevated shell; CurrentUser:
  %LOCALAPPDATA%\Programs\FASTag, or an earlier per-user install's folder)
  and runs the CLI the app bundles exactly where the installer put it, the way the
  app starts it: no console window (CREATE_NO_WINDOW), OPENMS_DATA_PATH and
  FASTAG_TAXONOMY_DIR pointing into the installed resources, OPENBLAS_NUM_THREADS=1,
  and on an ARM64 host MIMALLOC_DISABLE_REDIRECT=1 (gui/src-tauri/src/fastag.rs cli_env).

    windows_installed_check.ps1 -Installer <setup.exe> [-Scope AllUsers|CurrentUser]
                                [-Out <dir>] [-Keep] [-DirOut <file>]
                                [-ThermoRaw <file.raw>]

  -DirOut: a file the install folder is written to (for the steps after).

  Checks, each with the exit code printed in hex (0xC0000142 is
  STATUS_DLL_INIT_FAILED, 0xC0000135 STATUS_DLL_NOT_FOUND):
    - the installed app itself (fastag.exe with FASTAG_SELFTEST_OUT) runs its
      start-up probe of the bundled CLI -- the GUI's own resolution,
      environment and spawn path -- and reports the CLI ran;
    - FASTag.exe --help exits 0 and prints "Version: X.Y.Z";
    - FASTag.exe -write_ini writes the INI the Setup page is built from;
    - a tagging run on the bundled fixture exits 0 and writes tags;
    - the Thermo reader (1.15.2): its licence, notices and the .NET runtime
      are installed, --help carries RawFileReader's notice, and with
      -ThermoRaw <file.raw> (or FASTAG_THERMO_SMOKE_RAW) the installed CLI
      reads that .raw through the bundled runtime.
  Exactly one Apps entry must remain, in -Scope. Uninstalls afterwards unless
  -Keep, and checks that no file, folder, Apps entry or shortcut is left
  (windows_install_lib.ps1). Exits 1 on the first failure.
#>
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [ValidateSet('AllUsers', 'CurrentUser')][string]$Scope = 'AllUsers',
  [string]$Out = (Join-Path ([IO.Path]::GetTempPath()) 'fastag-installed-check'),
  [switch]$Keep,
  [string]$DirOut = '',
  [string]$ThermoRaw = $env:FASTAG_THERMO_SMOKE_RAW
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows_install_lib.ps1')
New-Item -ItemType Directory -Force $Out | Out-Null

$install = Install-Fastag $Installer @("/$Scope") $Scope
$Dest = $install.Dir
if ($DirOut) { Set-Content -Path $DirOut -Value $Dest -Encoding utf8 }
$R = Join-Path $Dest 'resources\fastag'
$exe = Join-Path $R 'bin\FASTag.exe'
if (-not (Test-Path $exe)) { Fail "no bundled CLI at $exe (installed: $((Get-ChildItem $Dest -Name) -join ', '))" }
# The notices and the example data travel with the installed app
# (tools/check_bundle_notices.sh checks the same on macOS and Linux).
foreach ($f in @('LICENSE', 'THIRD-PARTY-NOTICES.txt', 'GUI-THIRD-PARTY-NOTICES.txt', 'examples\Ecoli_MS2_small.mzML',
                 'LICENSES\ThermoRawFileReader-License.doc', 'LICENSES\ThermoRawFileReader-License.txt',
                 'share\OpenMS\openms_thermo_bridge\managed\ThermoFisher.CommonCore.RawFileReader.dll')) {
  if (-not (Test-Path (Join-Path $R $f))) { Fail "the installed app has no resources\fastag\$f" }
}
$guiNotices = Join-Path $R 'GUI-THIRD-PARTY-NOTICES.txt'
$n = (Get-Item $guiNotices).Length
if ($n -lt 200000) { Fail "GUI-THIRD-PARTY-NOTICES.txt is only $n bytes" }
foreach ($want in @('^tauri ', '^wry ', '^react ', 'IBM Plex', 'NSIS', '^\[T1\] used by', 'used by: .*NSIS bzip2 compression module', 'associated library "libbzip2", are copyright')) {
  if (-not (Select-String -Path $guiNotices -Pattern $want -Quiet)) { Fail "GUI-THIRD-PARTY-NOTICES.txt has no line matching '$want'" }
}
if (Select-String -Path (Join-Path $R 'THIRD-PARTY-NOTICES.txt') -Pattern 'licence text not found' -Quiet) { Fail 'THIRD-PARTY-NOTICES.txt lists a licence without its text' }
foreach ($want in @('Thermo RawFileReader -- licence terms for end users', 'may not redistribute the', '.NET runtime (dotnet/', 'opentims v1.2.0b4')) {
  if (-not (Select-String -Path (Join-Path $R 'THIRD-PARTY-NOTICES.txt') -Pattern $want -SimpleMatch -Quiet)) { Fail "THIRD-PARTY-NOTICES.txt lacks '$want'" }
}
if (-not (Get-ChildItem (Join-Path $R 'bin\dotnet\host\fxr') -Recurse -Filter 'hostfxr.dll' -ErrorAction SilentlyContinue)) { Fail 'no .NET runtime (bin\dotnet\host\fxr\*\hostfxr.dll) in the installed app' }
$exSha = (Get-FileHash (Join-Path $R 'examples\Ecoli_MS2_small.mzML') -Algorithm SHA256).Hash.ToLower()
if ($exSha -ne '30717211f2a832e281604a4cdc12d13d74f484d9fb51a5d94a62f80713c16f6e') { Fail "examples\Ecoli_MS2_small.mzML has sha256 $exSha" }
Write-Host "notices: GUI-THIRD-PARTY-NOTICES.txt $n bytes, THIRD-PARTY-NOTICES.txt $((Get-Item (Join-Path $R 'THIRD-PARTY-NOTICES.txt')).Length) bytes; example data present"
$dlls = (Get-ChildItem (Join-Path $R 'bin') -Filter *.dll).Count
Write-Host "installed to $Dest; bundled CLI $exe with $dlls DLLs beside it"
Write-Host ("host: {0}, process arch {1}, native {2}" -f [Environment]::OSVersion.VersionString, $env:PROCESSOR_ARCHITECTURE, (Get-CimInstance Win32_Processor | Select-Object -First 1).Name)

# Windows on ARM64 (the x64 app runs emulated): the GUI disables the mimalloc
# CRT redirection for its CLI children, as cli_env() does.
$arm64 = (Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture -eq 12
Write-Host "ARM64 host: $arm64"

# The app's own start-up probe, through its own code (fastag.rs self_test).
$selftest = Join-Path $Out 'selftest.json'
Remove-Item $selftest -ErrorAction SilentlyContinue
$gui = Join-Path $Dest 'fastag.exe'
$env:FASTAG_SELFTEST_OUT = $selftest
$g = Start-Process -FilePath $gui -PassThru
$null = $g.Handle  # keeps ExitCode readable after the exit
Remove-Item Env:FASTAG_SELFTEST_OUT
if (-not $g.WaitForExit(180000)) { $g.Kill(); Fail 'the app did not finish its self-test within 180 s' }
$sj = if (Test-Path $selftest) { Get-Content $selftest -Raw } else { '(no self-test output)' }
Write-Host ("app self-test: exit {0}; {1}" -f $g.ExitCode, ($sj -replace '\s+', ' '))
if ($g.ExitCode -ne 0) { Fail "the installed app could not run its bundled CLI: $sj" }

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
  # The installed app's own .NET runtime (bin\dotnet), never this runner's.
  $psi.EnvironmentVariables.Remove('DOTNET_ROOT')
  if ($arm64) { $psi.EnvironmentVariables['MIMALLOC_DISABLE_REDIRECT'] = '1' }
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
if (-not $help.Contains('RawFileReader reading tool. Copyright')) { Fail '--help lacks the RawFileReader notice' }

$ini = Join-Path $Out 'defaults.ini'
Invoke-Cli 'FASTag.exe -write_ini' @('-write_ini', $ini) | Out-Null
if (-not (Select-String -Path $ini -Pattern 'fragment_tolerance' -Quiet)) { Fail "-write_ini wrote no parameters to $ini" }

$mz = Join-Path $R 'share\OpenMS\examples\ID\Ecoli_MS2_small.mzML'
$tsv = Join-Path $Out 'installed.tags.tsv'
Invoke-Cli 'FASTag.exe tagging run' @('-in', $mz, '-out', $tsv, '-threads', '2') | Out-Null
$rows = (Get-Content $tsv | Measure-Object -Line).Lines
if ($rows -lt 2) { Fail "the tagging run wrote $rows lines to $tsv" }
Write-Host "tagging run: $rows lines in $tsv"

if ($ThermoRaw) {
  if (-not (Test-Path $ThermoRaw)) { Fail "-ThermoRaw $ThermoRaw does not exist" }
  $rawLog = Invoke-Cli 'FASTag.exe on a Thermo .raw' @('-in', $ThermoRaw, '-out', (Join-Path $Out 'installed.raw.tsv'), '-threads', '2')
  $m = [regex]::Match($rawLog, 'Thermo \.raw input: ([1-9][0-9]*) scans indexed')
  if (-not $m.Success) { Write-Host $rawLog; Fail 'the installed CLI read no scans from the .raw' }
  Write-Host "Thermo .raw through the installed app: $($m.Groups[1].Value) scans indexed"
} else {
  Write-Host '::warning::no -ThermoRaw given: the installed Thermo reader was not run'
}

if (-not $Keep) { Uninstall-Fastag $install }
Write-Host "installed-app check passed ($Scope, $Dest)"
