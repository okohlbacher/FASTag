<#
  The Windows installer's scopes, upgrade and uninstall, on a clean machine
  in an elevated shell (a CI runner):

    windows_install_scopes.ps1 -Installer <new setup.exe> -Previous <v1.13.3 setup.exe>

  1. The previous release (per user only, %LOCALAPPDATA%\FASTag), then the
     new installer with /S (elevated: all users). The pre-install hook
     (gui/src-tauri/windows/installer-hooks.nsh) must remove the per-user
     copy: one Apps entry, all users, the old folder gone.
  2. /S /CurrentUser over the all-users install: the hook removes the
     all-users copy; one per-user entry.
  3. Uninstall it: no file, folder, Apps entry or shortcut left.
  4. A fresh /S /AllUsers install, uninstalled the same way.
  Exits 1 on the first failure. Uses windows_install_lib.ps1.
#>
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Previous
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows_install_lib.ps1')

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host "elevated: $admin; host: $([Environment]::OSVersion.VersionString), $env:PROCESSOR_ARCHITECTURE"
if (-not $admin) { Fail 'the scope checks need an elevated shell (all-users installs)' }
if ((Show-FastagInstalls 'before').Count) { Fail 'FASTag is already installed on this machine' }

Write-Host '--- 1. upgrade: previous per-user release, then the new installer (/S, elevated)'
$old = Install-Fastag $Previous @() 'CurrentUser'
Write-Host "previous: $($old.Version) in $($old.Dir)"
$new = Install-Fastag $Installer @() 'AllUsers'
# The version this tree builds: a pre-release dry run may carry the previous release's number.
# CMakeLists.txt carries the version every package uses (the job's sparse checkout has no gui/src-tauri).
$want = [regex]::Match((Get-Content -Raw (Join-Path $PSScriptRoot '..\CMakeLists.txt')), 'project\(FASTag VERSION ([0-9.]+)').Groups[1].Value
if (-not $want) { Fail 'no project(FASTag VERSION ...) in CMakeLists.txt' }
if ($new.Version -ne $want) { Fail "the new installer registered $($new.Version), expected $want" }
$left = Wait-Gone $old.Dir
if ($left.Count -or (Test-Path $old.Dir)) { Fail "the upgrade left the per-user copy in $($old.Dir) ($($left.Count) files: $(($left | Select-Object -First 10) -join ', '))" }
Write-Host "upgrade: $($old.Version) per user -> $($new.Version) for all users; the per-user copy is gone"

Write-Host '--- 2. /S /CurrentUser over the all-users install'
$cu = Install-Fastag $Installer @('/CurrentUser') 'CurrentUser'
$left = Wait-Gone $new.Dir
if ($left.Count -or (Test-Path $new.Dir)) { Fail "the per-user install left the all-users copy in $($new.Dir) ($($left.Count) files: $(($left | Select-Object -First 10) -join ', '))" }
Write-Host "per user in $($cu.Dir); the all-users copy is gone"

Write-Host '--- 3. uninstall the per-user install'
Uninstall-Fastag $cu

Write-Host '--- 4. fresh /S /AllUsers, then uninstall'
$au = Install-Fastag $Installer @('/AllUsers') 'AllUsers'
if ($au.Dir -ne (Join-Path $env:ProgramFiles 'FASTag')) { Fail "all-users install in $($au.Dir), want $env:ProgramFiles\FASTag" }
Uninstall-Fastag $au
if ((Show-FastagInstalls 'after').Count) { Fail 'an Apps entry is left' }
Write-Host 'install scopes check passed'
