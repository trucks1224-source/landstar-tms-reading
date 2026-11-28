# Builds teammate-setup\out\Landstar-Bot-Setup.zip for teammates: Setup.bat + setup.ps1 +
# instructions + the upload bot's code. No secrets (.env), no Landstar sign-ins, no queues, no
# customer files. (Not in dist\: the website build empties that folder.)
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File teammate-setup\build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$setupDir = Join-Path $root 'teammate-setup'
$botDir = Join-Path $root 'bot'
$stage = Join-Path $root 'teammate-setup\out\Landstar-Bot-Setup'
$zip = Join-Path $root 'teammate-setup\out\Landstar-Bot-Setup.zip'

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'bot') | Out-Null

# The upload bot and everything it loads, plus its package list.
$traced = @(& node (Join-Path $setupDir 'trace-deps.cjs'))
if ($LASTEXITCODE -ne 0 -or -not ($traced -contains 'upload.js')) { throw 'Could not list the bot files (trace-deps.cjs failed).' }
$files = $traced + @('package.json', 'package-lock.json', 'automation-policy.json', 'update.js', 'team-files.json')
# The list teammates' bots download from GitHub to update themselves (bot\update.js). Commit and
# push it with the bot code: an update reaches teammates once it is on GitHub's main branch.
$teamList = @($traced + @('package.json', 'package-lock.json', 'automation-policy.json', 'update.js') | Sort-Object -Unique |
  Where-Object { $_ -notmatch '(^|[\\/])(agent-config|protected-loads)\.json$' -and $_ -notmatch '\.env' })
$manifest = [ordered]@{ note = 'Files a teammate bot keeps up to date (written by teammate-setup\build.ps1).'; files = $teamList }
[IO.File]::WriteAllText((Join-Path $botDir 'team-files.json'), ($manifest | ConvertTo-Json -Depth 3), (New-Object System.Text.UTF8Encoding($false)))
foreach ($name in ($files | Sort-Object -Unique)) {
  if ($name -match '(^|[\\/])(agent-config|protected-loads)\.json$' -or $name -match '\.env') { continue }
  $target = Join-Path (Join-Path $stage 'bot') $name
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -Path (Join-Path $botDir $name) -Destination $target
}

Copy-Item (Join-Path $setupDir 'Setup.bat'), (Join-Path $setupDir 'setup.ps1'), (Join-Path $setupDir 'How to install.txt') $stage

# The posting codes of this computer (the owner's) are refused during a teammate's setup,
# except codes a teammate really uses (teammate-setup\shared-codes.txt; SNB is Ivan's,
# Daniel 2026-11-27).
$ownerConfig = Join-Path $botDir 'agent-config.json'
$sharedFile = Join-Path $setupDir 'shared-codes.txt'
$shared = @()
if (Test-Path $sharedFile) { $shared = @(Get-Content $sharedFile | ForEach-Object { $_.Trim().ToUpper() } | Where-Object { $_ -and -not $_.StartsWith('#') }) }
if (Test-Path $ownerConfig) {
  (Get-Content $ownerConfig -Raw | ConvertFrom-Json).postingCodes |
    Where-Object { $shared -notcontains $_.Trim().ToUpper() } |
    Set-Content -Path (Join-Path $stage 'blocked-codes.txt') -Encoding ascii
}

# Never ship secrets or sign-ins, even by mistake.
$leaks = Get-ChildItem -Recurse -File $stage | Where-Object { $_.Name -match '^\.env|auth\.json$|queue\.json$|agent-config\.json$' }
if ($leaks) { throw "Refusing to build: private files in the zip: $($leaks.Name -join ', ')" }

if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Write-Host "Built $zip ($((Get-ChildItem -Recurse -File $stage).Count) files)" -ForegroundColor Green
