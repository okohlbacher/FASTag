<#
  Helpers for the Windows installer checks (dot-sourced by
  windows_installed_check.ps1 and windows_install_scopes.ps1).

  The NSIS installer (Tauri, installMode "both") installs per user (HKCU,
  %LOCALAPPDATA%\Programs\FASTag, or the folder of an earlier per-user
  install) or for all users (HKLM, %ProgramFiles%\FASTag). Silent switches:
  /S alone picks all users when elevated (CI runners are), /S /AllUsers and
  /S /CurrentUser choose; /D= is not honoured in this mode.
#>

$script:UninstKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\FASTag'

function Fail([string]$msg) { Write-Host "::error::$msg"; exit 1 }

# Every FASTag Apps entry: @{ Scope; Key; Dir; Version; Uninstall }.
function Get-FastagInstalls {
  $found = @()
  foreach ($s in @(
      @{ Scope = 'AllUsers'; Root = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FASTag' },
      @{ Scope = 'AllUsers'; Root = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\FASTag' },
      @{ Scope = 'CurrentUser'; Root = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FASTag' })) {
    $k = Get-ItemProperty -Path $s.Root -ErrorAction SilentlyContinue
    if ($k -and $k.UninstallString) {
      $found += [pscustomobject]@{
        Scope     = $s.Scope
        Key       = $s.Root
        Dir       = ($k.InstallLocation -replace '"', '')
        Version   = $k.DisplayVersion
        Uninstall = ($k.UninstallString -replace '"', '')
      }
    }
  }
  return , $found
}

function Show-FastagInstalls([string]$when) {
  $all = Get-FastagInstalls
  if (-not $all.Count) { Write-Host "${when}: no FASTag install registered"; return $all }
  foreach ($i in $all) { Write-Host ("{0}: {1} {2} in {3} ({4})" -f $when, $i.Scope, $i.Version, $i.Dir, $i.Key) }
  return $all
}

# Run the installer silently with @p Switches; returns the one install left.
# Fails unless exactly one Apps entry remains, in scope @p Expect.
function Install-Fastag([string]$Installer, [string[]]$Switches, [string]$Expect) {
  $argv = @('/S') + $Switches
  Write-Host "install: $(Split-Path $Installer -Leaf) $($argv -join ' ')"
  $t = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $Installer -ArgumentList $argv -Wait -PassThru
  Write-Host ("installer exit {0} after {1:N0} s" -f $p.ExitCode, $t.Elapsed.TotalSeconds)
  if ($p.ExitCode -ne 0) { Fail "installer $($argv -join ' ') exited $($p.ExitCode)" }
  $all = Show-FastagInstalls 'after install'
  if ($all.Count -ne 1) { Fail "$($all.Count) FASTag Apps entries after $($argv -join ' '), want 1: $(($all | ForEach-Object { "$($_.Scope) $($_.Dir)" }) -join '; ')" }
  $i = $all[0]
  if ($Expect -and $i.Scope -ne $Expect) { Fail "installed for $($i.Scope), want $Expect" }
  if (-not (Test-Path (Join-Path $i.Dir 'fastag.exe'))) { Fail "no fastag.exe in $($i.Dir)" }
  $root = if ($i.Scope -eq 'AllUsers') { $env:ProgramFiles } else { $env:LOCALAPPDATA }
  if (-not $i.Dir.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { Fail "$($i.Scope) install in $($i.Dir), not under $root" }
  $files = @(Get-ChildItem $i.Dir -Recurse -Force -File)
  $bytes = ($files | Measure-Object Length -Sum).Sum
  Write-Host ("footprint: {0} files, {1:N0} bytes ({2:N1} MiB) in {3}" -f $files.Count, $bytes, ($bytes / 1MB), $i.Dir)
  return $i
}

# What a folder still holds (files, relative), or @() when it is gone.
function Get-Leftovers([string]$Dir) {
  if (-not (Test-Path $Dir)) { return , @() }
  return , @(Get-ChildItem $Dir -Recurse -Force -File | ForEach-Object { $_.FullName.Substring($Dir.Length).TrimStart('\') })
}

# Uninstall @p Install silently and check it left no file, no Apps entry and
# no Start-menu shortcut. The app data folders (settings, history, WebView2)
# and the install-location key stay unless "Delete app data" is ticked,
# which a silent uninstall never is: they are listed, not failed. @p Allow:
# files (relative to the install folder) the user put there themselves,
# which the uninstaller rightly keeps (the taxonomy index unpacked into the
# install).
function Uninstall-Fastag($Install, [string[]]$Allow = @()) {
  Write-Host "uninstall: $($Install.Scope) $($Install.Dir)"
  Start-Process -FilePath $Install.Uninstall -ArgumentList '/S' -Wait | Out-Null
  # Without _?= the uninstaller copies itself to %TEMP% and returns at once:
  # wait for its copy to finish.
  $t = [Diagnostics.Stopwatch]::StartNew()
  # The registry key goes last, after the files and uninstall.exe.
  while (((Test-Path $Install.Key) -or (Test-Path (Join-Path $Install.Dir 'uninstall.exe'))) -and $t.Elapsed.TotalSeconds -lt 300) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 2
  $all = Get-Leftovers $Install.Dir
  $mine = @($all | Where-Object { $Allow -contains $_ })
  $left = @($all | Where-Object { $Allow -notcontains $_ })
  if ($left.Count) { Fail "uninstall left $($left.Count) files in $($Install.Dir): $(($left | Select-Object -First 20) -join ', ')" }
  foreach ($f in $mine) { Write-Host "  kept (put there by the user, by design): $f" }
  if (-not $mine.Count -and (Test-Path $Install.Dir)) { Fail "uninstall left the empty folder $($Install.Dir)" }
  if (Test-Path $Install.Key) { Fail "uninstall left the Apps entry $($Install.Key)" }
  $menus = @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")
  foreach ($m in $menus) {
    foreach ($lnk in @("$m\FASTag.lnk", "$m\FASTag\FASTag.lnk")) { if (Test-Path $lnk) { Fail "uninstall left the shortcut $lnk" } }
  }
  if (Test-Path "$env:PUBLIC\Desktop\FASTag.lnk") { Fail 'uninstall left the desktop shortcut' }
  Write-Host ("uninstalled in {0:N0} s: no file, folder, Apps entry or shortcut left" -f $t.Elapsed.TotalSeconds)
  foreach ($kept in @("$env:APPDATA\de.openms.fastag", "$env:LOCALAPPDATA\de.openms.fastag")) {
    if (Test-Path $kept) { Write-Host ("  kept (app data, by design): {0} ({1} files)" -f $kept, (Get-ChildItem $kept -Recurse -Force -File -ErrorAction SilentlyContinue).Count) }
  }
  foreach ($k in @('HKCU:\Software\openms\FASTag', 'HKLM:\SOFTWARE\openms\FASTag')) {
    if (Test-Path $k) { Write-Host "  kept (install location for the next install, by design): $k" }
  }
}
