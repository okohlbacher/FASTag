<#
  TEMPORARY (post1133/win-install): measure why the uninstaller leaves the
  CLI's files on Windows on ARM64 after the app and CLI ran.
    windows_uninstall_probe.ps1 -Dir <install dir> [-Variant plain|xtastop]
#>
param([Parameter(Mandatory = $true)][string]$Dir, [string]$Variant = 'plain')
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'windows_install_lib.ps1')

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Rm {
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
    if (e != 0) { r.Add("RmStartSession " + e); return r; }
    try {
      e = RmRegisterResources(h, (uint)files.Length, files, 0, IntPtr.Zero, 0, null);
      if (e != 0) { r.Add("RmRegisterResources " + e); return r; }
      uint needed = 0, n = 0, reasons = 0; e = RmGetList(h, out needed, ref n, null, ref reasons);
      if (e == 234) { var a = new INFO[needed]; n = needed; e = RmGetList(h, out needed, ref n, a, ref reasons);
        for (int i = 0; i < n; i++) r.Add(a[i].p.pid + " " + a[i].app + " svc=" + a[i].svc + " type=" + a[i].type); }
      r.Add("RmGetList " + e + " count " + n);
    } finally { RmEndSession(h); }
    return r;
  }
}
'@

function Stamp([string]$m) { Write-Host ("[{0:HH:mm:ss.fff}] {1}" -f (Get-Date), $m) }
function Show-Procs([string]$when) {
  Stamp "processes ($when) matching fastag/uninstall/Un_/nsu/msedge/tauri:"
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'fastag|uninst|^Un_|nsu|msedge|tauri|webview' -or ($_.CommandLine -and $_.CommandLine -match 'fastag') } |
    ForEach-Object { Write-Host ("  pid {0} ppid {1} {2} exe='{3}' cmd='{4}'" -f $_.ProcessId, $_.ParentProcessId, $_.Name, $_.ExecutablePath, $_.CommandLine) }
}
function Show-Handles([string]$when, [string]$path) {
  if ($script:handle) {
    Stamp "handle64 ($when) $path"
    & $script:handle -accepteula -nobanner -u $path 2>&1 | Select-Object -First 40 | ForEach-Object { Write-Host "  $_" }
  }
  $files = @(Get-ChildItem $path -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in '.exe', '.dll' } | ForEach-Object FullName)
  if ($files.Count) { Stamp "restart manager ($when) over $($files.Count) exe/dll"; [Rm]::Who($files) | ForEach-Object { Write-Host "  $_" } }
}

$arm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or (Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture -eq 12
$hd = Join-Path $env:RUNNER_TEMP 'sysinternals'; New-Item -ItemType Directory -Force $hd | Out-Null
$hname = if ($arm) { 'handle64a.exe' } else { 'handle64.exe' }
try { Invoke-WebRequest "https://live.sysinternals.com/$hname" -OutFile "$hd\$hname"; $script:handle = "$hd\$hname" } catch { Stamp "no handle: $_" }
Stamp "variant $Variant, ARM64 $arm"
Get-Service XtaCache -ErrorAction SilentlyContinue | ForEach-Object { Stamp "XtaCache service: $($_.Status) $($_.StartType)" }
$mp = Get-MpComputerStatus -ErrorAction SilentlyContinue; if ($mp) { Stamp "Defender realtime $($mp.RealTimeProtectionEnabled) onaccess $($mp.OnAccessProtectionEnabled)" }

$inst = (Get-FastagInstalls)[0]
Stamp "install $($inst.Scope) $($inst.Dir)"
Show-Procs 'before uninstall'
Show-Handles 'before uninstall' $inst.Dir
if ($Variant -eq 'xtastop') { Stop-Service XtaCache -Force -ErrorAction Continue; Get-Service XtaCache | ForEach-Object { Stamp "XtaCache now $($_.Status)" } }

Stamp "start $($inst.Uninstall) /S"
Start-Process -FilePath $inst.Uninstall -ArgumentList '/S' -Wait | Out-Null
Stamp 'launcher returned'
$t = [Diagnostics.Stopwatch]::StartNew(); $last = -1; $shown = $false
while ($t.Elapsed.TotalSeconds -lt 240) {
  $left = Get-Leftovers $inst.Dir
  $key = Test-Path $inst.Key
  if ($left.Count -ne $last) { Stamp ("{0} files left, key {1}" -f $left.Count, $key); $last = $left.Count }
  if (-not $key -and -not $left.Count) { break }
  if (-not $key -and -not $shown -and $t.Elapsed.TotalSeconds -gt 5) {
    $shown = $true
    Show-Procs 'key gone, files left'
    Show-Handles 'key gone, files left' $inst.Dir
    $first = Join-Path $inst.Dir 'resources\fastag\bin\FASTag.exe'
    foreach ($f in @($first, (Join-Path $inst.Dir 'uninstall.exe'))) {
      if (Test-Path $f) {
        try { [IO.File]::Delete($f); Stamp "deleted $f by hand: exists now $(Test-Path $f)" } catch { Stamp ("delete {0}: {1} HResult 0x{2:X8}" -f $f, $_.Exception.InnerException.Message, $_.Exception.InnerException.HResult) }
      }
    }
  }
  if ($key -and $t.Elapsed.TotalSeconds -gt 30 -and -not $shown) { $shown = $true; Show-Procs 'key still there after 30 s'; Show-Handles 'key still there' $inst.Dir }
  Start-Sleep -Milliseconds 500
}
Stamp ("end after {0:N0} s: {1} files left: {2}" -f $t.Elapsed.TotalSeconds, (Get-Leftovers $inst.Dir).Count, ((Get-Leftovers $inst.Dir) | Select-Object -First 40) -join ', ')
Show-Procs 'end'
Get-Service XtaCache -ErrorAction SilentlyContinue | ForEach-Object { Stamp "XtaCache service: $($_.Status)" }
Get-WinEvent -LogName 'Microsoft-Windows-Windows Defender/Operational' -MaxEvents 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ("  defender {0:HH:mm:ss} {1} {2}" -f $_.TimeCreated, $_.Id, ($_.Message -split "`n")[0]) }
