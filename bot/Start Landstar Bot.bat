@echo off
title Landstar Bot (watching for exports)
cd /d "%~dp0"
echo Starting the Landstar bot...
echo Leave this window open while you work. Close THIS window to turn the bot off (closing its browser window just reopens it).
echo.
node upload.js --watch --dedicated-rates
echo.
echo The Landstar bot has stopped.
pause
