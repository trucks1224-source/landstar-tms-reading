@echo off
title Landstar Rate Worker
cd /d "%~dp0"
echo Starting the dedicated rate worker.
echo Sign in to Landstar in its browser if asked.
echo Rates follow the existing rules; this worker never uploads loads.
node rates.js
echo The rate worker has stopped.
pause
