[CmdletBinding()]
param(
    [ValidateSet('set60', 'restore')] [string]$Action,
    [Parameter(Mandatory = $true)] [string]$SnapshotPath
)
$ErrorActionPreference = 'Stop'
$workspaceDir = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$evidenceDir = [System.IO.Path]::GetFullPath((Join-Path $workspaceDir '.artifacts/11.4'))
$destination = [System.IO.Path]::GetFullPath((Join-Path $workspaceDir $SnapshotPath))
if (-not $destination.StartsWith($evidenceDir + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Display evidence must stay in .artifacts/11.4.' }

# Query with the 220-byte DEVMODEW capacity, retaining the public size actually
# returned by the driver (188 or220 bytes, both include display frequency).
# Only dmDisplayFrequency at offset184 is changed, without registry writes.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PerformanceDisplay {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] static extern bool EnumDisplaySettingsW(string device, int mode, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] static extern int ChangeDisplaySettingsExW(string device, IntPtr data, IntPtr window, uint flags, IntPtr parameter);
  public static byte[] Current() {
    IntPtr data=Marshal.AllocHGlobal(220);
    try {
      for(int at=0;at<220;at++) Marshal.WriteByte(data,at,0);
      Marshal.WriteInt16(data,68,220);
      if(!EnumDisplaySettingsW(null,-1,data)) throw new Exception("Current display query failed.");
      int size=(ushort)Marshal.ReadInt16(data,68);
      if((size!=188 && size!=220) || Marshal.ReadInt16(data,70)!=0)
        throw new Exception("Unsupported driver-specific display structure; no settings changed.");
      byte[] bytes=new byte[size]; Marshal.Copy(data,bytes,0,size); return bytes;
    } finally { Marshal.FreeHGlobal(data); }
  }
  public static int Apply(byte[] bytes, bool test) {
    if((bytes.Length!=188 && bytes.Length!=220) || BitConverter.ToUInt16(bytes,68)!=bytes.Length || BitConverter.ToUInt16(bytes,70)!=0)
      throw new Exception("Invalid display snapshot.");
    IntPtr data=Marshal.AllocHGlobal(bytes.Length);
    try { Marshal.Copy(bytes,0,data,bytes.Length); return ChangeDisplaySettingsExW(null,data,IntPtr.Zero,test?2u:0u,IntPtr.Zero); }
    finally { Marshal.FreeHGlobal(data); }
  }
  public static byte[] At60(byte[] original) {
    byte[] bytes=(byte[])original.Clone();
    Array.Copy(BitConverter.GetBytes(0x00400000u),0,bytes,72,4);
    Array.Copy(BitConverter.GetBytes(60u),0,bytes,184,4);
    return bytes;
  }
  public static object Describe(byte[] bytes) {
    return new { width=BitConverter.ToUInt32(bytes,172), height=BitConverter.ToUInt32(bytes,176), frequency=BitConverter.ToUInt32(bytes,184), bitsPerPixel=BitConverter.ToUInt32(bytes,168) };
  }
}
'@
function Write-NewJson([string]$Path, $Value) {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 7) + "`n")
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try { $stream.Write($bytes) } finally { $stream.Dispose() }
}
$current = [PerformanceDisplay]::Current()
if ($Action -eq 'set60') {
    if (Test-Path -LiteralPath $destination) { throw 'Use a new display snapshot path.' }
    $requested = [PerformanceDisplay]::At60($current)
    $test = [PerformanceDisplay]::Apply($requested, $true)
    if ($test -ne 0) { throw "The current display does not accept60Hz (test result $test); no settings changed." }
    # Persist the exact restoration data before changing display state.
    Write-NewJson $destination @{
        createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        originalModeBase64 = [Convert]::ToBase64String($current)
        original = [PerformanceDisplay]::Describe($current)
        requested = [PerformanceDisplay]::Describe($requested)
        registryWritten = $false
    }
    $result = [PerformanceDisplay]::Apply($requested, $false)
    Write-NewJson ($destination + '.applied.json') @{
        result = $result
        observed = [PerformanceDisplay]::Describe([PerformanceDisplay]::Current())
        atUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    if ($result -ne 0) { throw "Display change failed: $result" }
} else {
    $saved = Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
    $description = [PerformanceDisplay]::Describe($current)
    if ($description.width -ne $saved.original.width -or $description.height -ne $saved.original.height -or $description.frequency -ne 60) {
        throw 'The display changed independently; automatic restoration refused to overwrite the new state.'
    }
    $original = [Convert]::FromBase64String($saved.originalModeBase64)
    if ([PerformanceDisplay]::Apply($original, $true) -ne 0) { throw 'The saved original mode is no longer available.' }
    $result = [PerformanceDisplay]::Apply($original, $false)
    Write-NewJson ($destination + '.restored.json') @{
        result = $result
        observed = [PerformanceDisplay]::Describe([PerformanceDisplay]::Current())
        atUtc = (Get-Date).ToUniversalTime().ToString('o')
    }
    if ($result -ne 0) { throw "Display restoration failed: $result" }
}
