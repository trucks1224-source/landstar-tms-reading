@echo off
title Landstar Watchdog (keeps everything running)
cd /d "%~dp0"
echo Starting the Landstar watchdog...
echo.
echo This keeps the TMS, posting, helper, removal and rate workers running:
echo if any of them stops, the watchdog starts it again.
echo.
echo Leave THIS window open while you work. Close it to turn the watchdog off.
echo.
node bot\watchdog.js
echo.
echo The watchdog has stopped.
pause
