@echo off
title Landstar sign-in starter
cd /d "%~dp0"
rem Runs from the Windows Startup folder when you sign in (also safe to double-click).
rem 1. Starts the watchdog, which starts the TMS and keeps it (and the bots) running.
rem 2. Waits until the TMS answers, then opens the Landstar TMS window.

rem Start the watchdog unless one is already running.
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*watchdog.js*' }) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo The watchdog is already running.
) else (
  echo Starting the watchdog...
  start "Landstar Watchdog" /min "%~dp0Start Everything (watchdog).bat"
)

echo Waiting for the TMS to start (up to 3 minutes)...
powershell -NoProfile -Command "for ($i=0; $i -lt 90; $i++) { try { Invoke-WebRequest http://127.0.0.1:5173 -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 2 } }; exit 1"
if not %errorlevel%==0 (
  echo The TMS did not start. Check the "Landstar TMS" and "Landstar Watchdog" windows.
  pause
  exit /b
)

rem Open the installed Landstar TMS app window (same as the old Startup shortcut).
start "" "C:\Program Files\Google\Chrome\Application\chrome_proxy.exe" --profile-directory=Default --app-id=gdgheecefcmlccfepljfcjakkdblfgmm
