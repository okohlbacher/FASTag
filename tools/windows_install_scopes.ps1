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
if ($new.Version -eq $old.Version) { Fail "the new installer registered the old version $($new.Version)" }
$left = Get-Leftovers $old.Dir
if ($left.Count -or (Test-Path $old.Dir)) { Fail "the upgrade left the per-user copy in $($old.Dir) ($($left.Count) files)" }
Write-Host "upgrade: $($old.Version) per user -> $($new.Version) for all users; the per-user copy is gone"

Write-Host '--- 2. /S /CurrentUser over the all-users install'
$cu = Install-Fastag $Installer @('/CurrentUser') 'CurrentUser'
if (Test-Path $new.Dir) { Fail "the per-user install left the all-users copy in $($new.Dir) ($((Get-Leftovers $new.Dir).Count) files)" }
Write-Host "per user in $($cu.Dir); the all-users copy is gone"

Write-Host '--- 3. uninstall the per-user install'
Uninstall-Fastag $cu

Write-Host '--- 4. fresh /S /AllUsers, then uninstall'
$au = Install-Fastag $Installer @('/AllUsers') 'AllUsers'
if ($au.Dir -ne (Join-Path $env:ProgramFiles 'FASTag')) { Fail "all-users install in $($au.Dir), want $env:ProgramFiles\FASTag" }
Uninstall-Fastag $au
if ((Show-FastagInstalls 'after').Count) { Fail 'an Apps entry is left' }
Write-Host 'install scopes check passed'
