# Brings a bot's window to the front (TMS problem banner, Daniel 2026-11-27: "take me to exactly
# where the error is"). Called by the TMS server (POST /api/go) with a fixed target only.
#   -Profile  the bot's Chrome profile folder name (its Landstar or Google window)
#   -Title    part of its console window title (where it writes its messages)
# Tries the profile window first, then the title. Prints "found" or "not found".
param([string]$Profile = '', [string]$Title = '')

Add-Type @'
using System; using System.Runtime.InteropServices;
public class TmsFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@

function Show-Front($handle) {
  # Minimise then restore: Windows lets a window come to the front this way even when the
  # request does not come from the window the user is using.
  [void][TmsFocus]::ShowWindow($handle, 6)
  [void][TmsFocus]::ShowWindow($handle, 9)
  [void][TmsFocus]::SetForegroundWindow($handle)
}

if ($Profile) {
  $pattern = '[\\/]' + [regex]::Escape($Profile) + '("|\s|$)'
  $owners = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -match $pattern -and $_.CommandLine -notmatch '--type=' }
  foreach ($owner in $owners) {
    $process = Get-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue
    if ($process -and $process.MainWindowHandle -ne 0) { Show-Front $process.MainWindowHandle; 'found'; exit 0 }
  }
}
if ($Title) {
  $process = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$Title*" } | Select-Object -First 1
  if ($process) { Show-Front $process.MainWindowHandle; 'found'; exit 0 }
}
'not found'
