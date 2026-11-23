@echo off
title Landstar Email Bot (dry run)
cd /d "%~dp0"
echo Starting the Landstar EMAIL bot in DRY RUN: it logs which emails are due and sends nothing.
echo Leave this window open. Close it to turn the email bot off.
echo.
node email-bot.js
echo.
echo The email bot has stopped.
pause
