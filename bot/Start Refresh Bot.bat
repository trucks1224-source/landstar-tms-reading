@echo off
title Landstar Refresh Bot
cd /d "%~dp0"
echo Starting the refresh bot: pauses and unpauses AMERI (5 min) and hazmat (30 min) postings so they show fresh on DAT.
echo Leave this window open. Close its browser window to stop.
node refresh-bot.js
echo The refresh bot has stopped.
pause
