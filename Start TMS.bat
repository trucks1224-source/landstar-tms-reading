@echo off
title Landstar TMS (keep this window open)
cd /d "%~dp0"

rem Already running? Just open it.
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:5173 -UseBasicParsing -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo The TMS is already running. Opening it...
  start "" http://127.0.0.1:5173
  timeout /t 3 >nul
  exit /b
)

echo Starting the Landstar TMS...
echo Leave this window open while you work. Closing it turns the TMS off.
echo.
rem Open the TMS in your browser once the server is up.
start "" /min cmd /c "timeout /t 5 >nul & start http://127.0.0.1:5173"
call npx vite --port 5173 --strictPort
echo.
echo The TMS has stopped. Double-click Start TMS to start it again.
pause
