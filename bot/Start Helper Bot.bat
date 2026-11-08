@echo off
title Landstar Helper Bot
cd /d "%~dp0"
echo Starting the Landstar HELPER bot (Assign Capacity, Clarity, MercuryGate)...
echo Leave this window open. Close the helper's browser window to turn it off.
echo.
node helper.js
echo.
echo The helper bot has stopped.
pause
