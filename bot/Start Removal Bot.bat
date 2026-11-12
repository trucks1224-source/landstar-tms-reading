@echo off
title Landstar Removal Bot
cd /d "%~dp0"
echo Starting the removal bot for TMS-approved missing-load removals.
echo Leave this window open. Close its browser window to stop.
node removal.js
echo The removal bot has stopped.
pause
