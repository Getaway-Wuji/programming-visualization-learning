[CmdletBinding()]
param([string]$OutputPath = ".artifacts/11.4/conditions-host-$(Get-Date -Format 'yyyyMMdd-HHmmss').json")
$ErrorActionPreference = 'Stop'
$workspaceDir = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$evidenceDir = [System.IO.Path]::GetFullPath((Join-Path $workspaceDir '.artifacts/11.4'))
if ([System.IO.Path]::IsPathRooted($OutputPath)) { throw 'Use a workspace-relative host evidence path.' }
$destination = [System.IO.Path]::GetFullPath((Join-Path $workspaceDir $OutputPath))
if (-not $destination.StartsWith($evidenceDir + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Host evidence must stay in .artifacts/11.4.' }
if (Test-Path -LiteralPath $destination) { throw 'Use a new host evidence path.' }

# Read-only display/power APIs. No display, power-plan or application settings change.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PerformanceHostRead {
  [StructLayout(LayoutKind.Sequential)] public struct Power {
    public byte AC, Flags, Percent, Status;
    public uint LifeSeconds, FullLifeSeconds;
  }
  [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out Power power);
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint paths, IntPtr pathData, ref uint modes, IntPtr modeData, IntPtr topology);
  static uint UInt32At(IntPtr pointer, int offset) { return unchecked((uint)Marshal.ReadInt32(pointer, offset)); }
  static IntPtr Mode(IntPtr modes, uint count, uint index, uint kind, uint id, uint adapterLow, int adapterHigh) {
    if(index>=count) return IntPtr.Zero;
    IntPtr mode=IntPtr.Add(modes,checked((int)index*64));
    if(UInt32At(mode,0)!=kind || UInt32At(mode,4)!=id || UInt32At(mode,8)!=adapterLow || Marshal.ReadInt32(mode,12)!=adapterHigh) return IntPtr.Zero;
    return mode;
  }
  public static object[] ActiveDisplays() {
    for(int attempt=0; attempt<3; attempt++) {
      uint paths, modes;
      int result=GetDisplayConfigBufferSizes(2, out paths, out modes);
      if(result!=0) throw new Exception("Display buffer query: "+result);
      IntPtr pathData=Marshal.AllocHGlobal(checked((int)paths*72));
      IntPtr modeData=Marshal.AllocHGlobal(checked((int)modes*64));
      try {
        result=QueryDisplayConfig(2, ref paths, pathData, ref modes, modeData, IntPtr.Zero);
        if(result==122) continue;
        if(result!=0) throw new Exception("Active display query: "+result);
        object[] displays=new object[paths];
        for(int index=0; index<paths; index++) {
          IntPtr entry=IntPtr.Add(pathData,index*72);
          uint sourceLow=UInt32At(entry,0), sourceId=UInt32At(entry,8), sourceIndex=UInt32At(entry,12);
          int sourceHigh=Marshal.ReadInt32(entry,4);
          uint targetLow=UInt32At(entry,20), targetId=UInt32At(entry,28), targetIndex=UInt32At(entry,32);
          int targetHigh=Marshal.ReadInt32(entry,24);
          IntPtr source=Mode(modeData,modes,sourceIndex,1,sourceId,sourceLow,sourceHigh);
          IntPtr target=Mode(modeData,modes,targetIndex,2,targetId,targetLow,targetHigh);
          uint numerator=UInt32At(entry,48), denominator=UInt32At(entry,52);
          displays[index]=new {
            source=new {
              adapterLowPart=sourceLow, adapterHighPart=sourceHigh, id=sourceId, modeInfoIndex=sourceIndex,
              widthPixels=source==IntPtr.Zero ? (uint?)null : UInt32At(source,16),
              heightPixels=source==IntPtr.Zero ? (uint?)null : UInt32At(source,20),
              positionX=source==IntPtr.Zero ? (int?)null : Marshal.ReadInt32(source,28),
              positionY=source==IntPtr.Zero ? (int?)null : Marshal.ReadInt32(source,32)
            },
            target=new {
              adapterLowPart=targetLow, adapterHighPart=targetHigh, id=targetId, modeInfoIndex=targetIndex,
              widthPixels=target==IntPtr.Zero ? (uint?)null : UInt32At(target,40),
              heightPixels=target==IntPtr.Zero ? (uint?)null : UInt32At(target,44),
              outputTechnology=UInt32At(entry,36), rotation=UInt32At(entry,40), scaling=UInt32At(entry,44)
            },
            numerator, denominator, hz=denominator==0 ? (double?)null : (double)numerator/denominator,
            active=(UInt32At(entry,68)&1)!=0
          };
        }
        return displays;
      } finally { Marshal.FreeHGlobal(pathData); Marshal.FreeHGlobal(modeData); }
    }
    throw new Exception("Active displays changed during all three queries.");
  }
}
'@
$system = Get-CimInstance Win32_ComputerSystem
$operating = Get-CimInstance Win32_OperatingSystem
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$power = [PerformanceHostRead+Power]::new()
if (-not [PerformanceHostRead]::GetSystemPowerStatus([ref]$power)) { throw 'Power query failed.' }
$scheme = ((& powercfg /getactivescheme) -join ' ')
if ($LASTEXITCODE -ne 0) { throw 'Active power scheme query failed.' }
$schemeMatch = [regex]::Match($scheme, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
if (-not $schemeMatch.Success) { throw 'Active power scheme GUID was not returned.' }
$displays = @([PerformanceHostRead]::ActiveDisplays())
$browserPaths = @{
  chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  firefox = (Join-Path $workspaceDir '.tools/firefox/core/firefox.exe')
}
$browsers = @{}
foreach ($browser in $browserPaths.Keys) {
  $browsers[$browser] = if (Test-Path -LiteralPath $browserPaths[$browser]) {
    (Get-Item -LiteralPath $browserPaths[$browser]).VersionInfo.ProductVersion
  } else { $null }
}
$snapshot = [ordered]@{
  collectedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  methods = @('CIM ComputerSystem/OperatingSystem/Processor/VideoController', 'GetSystemPowerStatus', 'powercfg /getactivescheme', 'QueryDisplayConfig QDC_ONLY_ACTIVE_PATHS', 'File VersionInfo')
  manufacturer = $system.Manufacturer
  model = $system.Model
  cpu = $processor.Name
  cores = $processor.NumberOfCores
  logicalProcessors = $processor.NumberOfLogicalProcessors
  physicalMemoryBytes = $system.TotalPhysicalMemory
  visibleMemoryKiB = $operating.TotalVisibleMemorySize
  os = @{ version = $operating.Version; build = $operating.BuildNumber; caption = $operating.Caption; architecture = $operating.OSArchitecture; frozenBuild = '26200'; buildChanged = $operating.BuildNumber -ne '26200' }
  power = @{ acLineStatus = [int]$power.AC; batteryPercent = [int]$power.Percent; scheme = $scheme; schemeGuid = $schemeMatch.Value.ToLowerInvariant(); settingsChanged = $false }
  display = @{ activeDisplays = $displays; activePathCount = $displays.Count; activeRefreshRates = @($displays | Select-Object numerator,denominator,hz); controllers = @(Get-CimInstance Win32_VideoController | Select-Object Name,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate); settingsChanged = $false; browserRenderer = 'Recorded by each actual browser sample'; exact60ModeProven = $false }
  browserFileVersions = $browsers
  boundary = 'Read-only conditions at collection time. Active display identity is the QueryDisplayConfig source/target adapter LUID and ID path, not an EDID serial. Pixel dimensions come from source desktop and target signal active modes, not CSS viewport or millimetres. Per-sample viewport/focus/renderer are separate. Other user applications were not closed or inspected; no claim that every host process is idle. CurrentRefreshRate is rounded; rational activeRefreshRates are authoritative for this snapshot. Endpoint snapshots alone cannot exclude transient changes that return to the same state between captures.'
}
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($snapshot | ConvertTo-Json -Depth 8) + "`n")
$stream = [System.IO.File]::Open($destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
try { $stream.Write($bytes) } finally { $stream.Dispose() }
Write-Output $destination
