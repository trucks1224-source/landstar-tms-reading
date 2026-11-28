# Landstar Bot setup for a teammate's computer (run by Setup.bat).
#
# Installs the upload bot into %LOCALAPPDATA%\LandstarBot: Node.js if missing, the bot's packages,
# its own Chrome, this person's posting code, and a "Start Landstar Bot" desktop shortcut.
# Running it again updates the bot and keeps the posting code and the Landstar sign-in.
#
# The bot watches Downloads for TMS exports (Landstar_Bulk_*.xlsx), rate-checks them and posts
# them under THIS person's Landstar login and posting code only.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'LandstarBot'),
  [string]$PostingCode = '',
  [switch]$NoShortcuts,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Ask($question) { if ($Quiet) { return '' } return (Read-Host $question).Trim() }

Say ''
Say '=== Landstar Bot setup ===' 'Cyan'
Say "Installing into $InstallDir"
Say ''

# --- 0. This person's posting code (asked first, before anything is installed) ----
# Codes in blocked-codes.txt belong to the person who built this setup: never reused.
$blockedFile = Join-Path $here 'blocked-codes.txt'
$blocked = @()
if (Test-Path $blockedFile) { $blocked = @(Get-Content $blockedFile | ForEach-Object { $_.Trim().ToUpper() } | Where-Object { $_ }) }
$configFile = Join-Path $InstallDir 'agent-config.json'
$current = ''
if (Test-Path $configFile) {
  try { $current = ((Get-Content $configFile -Raw | ConvertFrom-Json).postingCodes -join ', ') } catch { $current = '' }
}
$code = $PostingCode.Trim().ToUpper()
if (-not $code -and $current) {
  $keep = Ask "Your posting code is $current. Press Enter to keep it, or type a new one"
  $code = if ($keep) { $keep.ToUpper() } else { $current }
}
while ($true) {
  if (-not $code) { $code = (Ask 'Type YOUR Landstar posting code (like ABC)').ToUpper() }
  if ($code -notmatch '^[A-Z0-9]{2,4}$') {
    Say 'A posting code is 2-4 letters or numbers, like ABC.' 'Red'
  } elseif ($blocked -contains $code) {
    Say "$code belongs to someone else on the team. Use your own posting code." 'Red'
  } else { break }
  if ($Quiet) { throw 'A valid posting code is required (-PostingCode).' }
  $code = ''
}

# --- 1. Node.js ---------------------------------------------------------------
function Get-NodeMajor {
  try { return [int]((& node -v) -replace '^v(\d+).*', '$1') } catch { return 0 }
}
if ((Get-NodeMajor) -lt 18) {
  Say 'Node.js is not installed (or too old). Installing it now...' 'Yellow'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Say 'Could not install Node.js automatically. Install the LTS version from https://nodejs.org, then run Setup again.' 'Red'
    Start-Process 'https://nodejs.org/en/download'
    exit 1
  }
  & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if ((Get-NodeMajor) -lt 18) {
    Say 'Node.js was installed but is not ready yet. Close this window and run Setup again.' 'Red'
    exit 1
  }
}
Say "Node.js $(& node -v) found." 'Green'

# --- 2. Bot files -----------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $here 'bot\*') -Destination $InstallDir -Recurse -Force
$protected = Join-Path $InstallDir 'protected-loads.json'
if (-not (Test-Path $protected)) { Set-Content -Path $protected -Value '[]' -Encoding ascii }
Say 'Bot files copied.' 'Green'

# --- 3. Packages and the bot's own Chrome -----------------------------------------
Push-Location $InstallDir
try {
  Say 'Installing bot packages (a minute or two)...'
  & npm.cmd ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm could not install the bot packages. Check the internet connection and run Setup again.' }
  Say 'Installing the bot browser (first time can take a few minutes)...'
  & npx.cmd playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw 'The bot browser could not be installed. Check the internet connection and run Setup again.' }
} finally { Pop-Location }
Say 'Packages ready.' 'Green'

# --- 4. Save this person's posting code (asked at the start) --------------------------
Set-Content -Path $configFile -Value ("{`n `"postingCodes`": [`"$code`"]`n}") -Encoding ascii
Say "Posting code set to $code. The bot will only ever touch postings under $code." 'Green'

# --- 5. Start button --------------------------------------------------------------------
$launcher = Join-Path $InstallDir 'Start Landstar Bot.bat'
@"
@echo off
title Landstar Bot (watching Downloads for TMS exports)
cd /d "%~dp0"
echo Starting the Landstar bot...
echo It watches your Downloads folder for TMS exports and posts them to Landstar.
echo Sign in to Landstar in the bot's browser window the first time.
echo Google Chat lists: turn them on in the TMS (My Settings - Google Chat lists); the chat bot then opens here too.
echo Leave this window open while you work. Close THIS window to turn the bot off (closing its browser window just reopens it).
echo.
set TEAM_AUTO_UPDATE=1
:start
node update.js
node upload.js --watch --no-hazmat-watch
if %ERRORLEVEL%==75 goto start
echo.
echo The Landstar bot has stopped.
pause
"@ | Set-Content -Path $launcher -Encoding ascii

if (-not $NoShortcuts) {
  $shell = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath('Desktop')
  $link = $shell.CreateShortcut((Join-Path $desktop 'Start Landstar Bot.lnk'))
  $link.TargetPath = $launcher
  $link.WorkingDirectory = $InstallDir
  $link.Save()
  Say 'Added "Start Landstar Bot" to the desktop.' 'Green'
  $atLogin = Ask 'Start the bot automatically when you log in to Windows? (Y/N)'
  if ($atLogin -match '^[Yy]') {
    $startup = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Start Landstar Bot.lnk'))
    $startup.TargetPath = $launcher
    $startup.WorkingDirectory = $InstallDir
    $startup.WindowStyle = 7
    $startup.Save()
    Say 'The bot will start when you log in.' 'Green'
  }
}

Say ''
Say '=== Done ===' 'Cyan'
Say 'Next: double-click "Start Landstar Bot" on the desktop and sign in to Landstar in the bot window.'
Say 'Then export loads from the TMS as usual; the bot posts them within a minute or two.'
