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
# Wait up to @p Seconds for @p Dir to disappear (an uninstaller may still be
# deleting large files, slower under ARM64 emulation and on-access scanning);
# return what is left, by name.
function Wait-Gone([string]$Dir, [int]$Seconds = 60) {
  $end = (Get-Date).AddSeconds($Seconds)
  while ((Test-Path $Dir) -and (Get-Date) -lt $end) { Start-Sleep -Seconds 2 }
  return , (Get-Leftovers $Dir)
}

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
# Processes running an executable from @p Dir (the GUI, its CLI children).
function Get-InstallProcesses([string]$Dir) {
  $root = (Resolve-Path -LiteralPath $Dir -ErrorAction SilentlyContinue).Path
  if (-not $root) { return , @() }
  return , @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) })
}

# The %TEMP% copies of an NSIS uninstaller (~nsuX.tmp\Un_X.exe) still running.
function Get-UninstallerCopies {
  return , @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -match '\\~nsu[^\\]*\.tmp\\[^\\]+\.exe$' })
}

# Who holds files under @p Dir: the Restart Manager over its executables and
# DLLs (processes that map or open them), Sysinternals handle where it can be
# fetched, and every process by name and command line (x64 processes under
# emulation on ARM64 included).
function Show-FileHolders([string]$Dir) {
  if (-not ('FastagRm' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class FastagRm {
  [StructLayout(LayoutKind.Sequential)] struct UNIQUE_PROCESS { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME t; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct INFO {
    public UNIQUE_PROCESS p; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string app;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string svc; public int type; public int status; public int session;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable; }
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint h, int f, string key);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint n, string[] files, uint a, IntPtr b, uint c, string[] d);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint needed, ref uint n, [In, Out] INFO[] info, ref uint reasons);
  public static List<string> Who(string[] files) {
    var r = new List<string>(); uint h; int e = RmStartSession(out h, 0, Guid.NewGuid().ToString());
    if (e != 0) { r.Add("RmStartSession error " + e); return r; }
    try {
      e = RmRegisterResources(h, (uint)files.Length, files, 0, IntPtr.Zero, 0, null);
      if (e != 0) { r.Add("RmRegisterResources error " + e); return r; }
      uint needed = 0, n = 0, reasons = 0; e = RmGetList(h, out needed, ref n, null, ref reasons);
      if (e == 234) { var a = new INFO[needed]; n = needed; e = RmGetList(h, out needed, ref n, a, ref reasons);
        for (int i = 0; i < n; i++) r.Add("pid " + a[i].p.pid + " " + a[i].app + (a[i].svc != "" ? " (service " + a[i].svc + ")" : "")); }
      if (e != 0) r.Add("RmGetList error " + e);
      else if (n == 0) r.Add("no process holds them");
    } finally { RmEndSession(h); }
    return r;
  }
}
'@
  }
  $files = @(Get-ChildItem $Dir -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object FullName)
  if (-not $files.Count) { return }
  foreach ($l in [FastagRm]::Who($files)) { Write-Host "  restart manager: $l" }
  $arm = (Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture -eq 12
  $h = Join-Path ([IO.Path]::GetTempPath()) ("sysinternals-" + [guid]::NewGuid().ToString('N'))
  $exe = Join-Path $h $(if ($arm) { 'handle64a.exe' } else { 'handle64.exe' })
  try {
    New-Item -ItemType Directory -Force $h | Out-Null
    Invoke-WebRequest "https://live.sysinternals.com/$(Split-Path $exe -Leaf)" -OutFile $exe -TimeoutSec 60
    & $exe -accepteula -nobanner -u $Dir 2>&1 | Select-Object -First 40 | ForEach-Object { Write-Host "  handle: $_" }
  } catch { Write-Host "  handle: not available ($($_.Exception.Message))" }
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'fastag|msedge|webview|tauri|^Un_' -or $_.ExecutablePath -match '~nsu' -or ($_.CommandLine -and $_.CommandLine -match 'fastag') } |
    ForEach-Object { Write-Host ("  process: pid {0} ppid {1} {2} '{3}'" -f $_.ProcessId, $_.ParentProcessId, $_.Name, $_.CommandLine) }
}

function Uninstall-Fastag($Install, [string[]]$Allow = @()) {
  Write-Host "uninstall: $($Install.Scope) $($Install.Dir)"
  # A process still running from the install keeps its exe and DLLs locked,
  # and the uninstaller then leaves them. Wait for them to end (slower under
  # x64 emulation on ARM64); one that does not end within 60 s is a failure,
  # named, not killed.
  $t = [Diagnostics.Stopwatch]::StartNew()
  while (($p = Get-InstallProcesses $Install.Dir).Count -and $t.Elapsed.TotalSeconds -lt 60) { Start-Sleep -Milliseconds 500 }
  if ($p.Count) { Fail "still running from $($Install.Dir) after 60 s: $(($p | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }) -join '; ')" }
  if ($t.Elapsed.TotalSeconds -ge 1) { Write-Host ("waited {0:N1} s for FASTag processes to end before uninstalling" -f $t.Elapsed.TotalSeconds) }
  Start-Process -FilePath $Install.Uninstall -ArgumentList '/S' -Wait | Out-Null
  # Without _?= the uninstaller copies itself to %TEMP%\~nsuX.tmp\Un_X.exe and
  # returns at once: wait for that copy to end (the registry key goes before
  # its post-uninstall hook retries files still in use, for up to 30 s).
  $t = [Diagnostics.Stopwatch]::StartNew()
  while (((Test-Path $Install.Key) -or (Get-UninstallerCopies).Count) -and $t.Elapsed.TotalSeconds -lt 300) { Start-Sleep -Milliseconds 500 }
  if (($u = Get-UninstallerCopies).Count) { Fail "the uninstaller still runs after 300 s: $(($u | ForEach-Object { "$($_.ProcessId) $($_.ExecutablePath)" }) -join '; ')" }
  Write-Host ("uninstaller finished after {0:N1} s" -f $t.Elapsed.TotalSeconds)
  $all = Get-Leftovers $Install.Dir
  $held = @($all | Where-Object { $Allow -notcontains $_ })
  if ($held.Count) {
    # Name who holds them, then give them a bounded time to go: a file still
    # held after 60 s fails, with its holder.
    Write-Host "uninstall left $($held.Count) files; holders:"
    Show-FileHolders $Install.Dir
    $w = [Diagnostics.Stopwatch]::StartNew()
    while (@(Get-Leftovers $Install.Dir | Where-Object { $Allow -notcontains $_ }).Count -and $w.Elapsed.TotalSeconds -lt 60) { Start-Sleep -Seconds 1 }
    Write-Host ("after {0:N0} s more: {1} files left" -f $w.Elapsed.TotalSeconds, @(Get-Leftovers $Install.Dir | Where-Object { $Allow -notcontains $_ }).Count)
    if (@(Get-Leftovers $Install.Dir | Where-Object { $Allow -notcontains $_ }).Count) { Show-FileHolders $Install.Dir }
  }
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
