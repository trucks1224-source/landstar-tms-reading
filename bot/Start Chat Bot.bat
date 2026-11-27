@echo off
title Landstar Google Chat Bot
cd /d "%~dp0"
echo Starting the Google Chat bot: it watches your Google Chat groups (Para lists, RXO LANDJA.18)
echo and sends new list pictures and spreadsheets to the TMS. It only reads; it never posts.
echo It is OFF until bot\chat-bot-config.json says "enabled": true with each chat's address.
echo Leave this window open. Close it to turn the Google Chat bot off.
echo.
node chat-bot.js
echo.
echo The Google Chat bot has stopped.
pause
