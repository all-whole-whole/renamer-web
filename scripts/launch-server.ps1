# Ensure the local host is running (idempotent, safe to call on every launch).
# Exit codes are the contract with start.cmd:
#   0 = host is up (started now or already running)
#   1 = server failed to start
#   2 = port is owned by another program
#   3 = Node.js not found
# ASCII only: cmd.exe / PowerShell 5.1 read this file with the OEM/ANSI code page.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$port = 8758
$hostAddr = '127.0.0.1'
$cfgPath = Join-Path $root 'config.json'
try {
  $cfg = Get-Content -Raw -LiteralPath $cfgPath | ConvertFrom-Json
  if ($cfg.port) { $port = [int]$cfg.port }
  if ($cfg.host) { $hostAddr = [string]$cfg.host }
} catch { }

$base = "http://${hostAddr}:$port"
$logDir = Join-Path $root '.tmp\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-AppStatus {
  try {
    $r = Invoke-RestMethod -Uri "$base/api/ping" -TimeoutSec 1 -ErrorAction Stop
    if ($r.app -eq 'renamer-web') { return $r }
  } catch { }
  return $null
}

function Test-PortOpen {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect($hostAddr, $port)
    $ok = $c.Connected
    $c.Close()
    return $ok
  } catch {
    return $false
  }
}

# Already up and it is really this app -> nothing to do.
if (Get-AppStatus) { exit 0 }

# Somebody else may own the port. A server of ours that is still booting also holds it,
# so give the identity check a moment before calling the port foreign.
if (Test-PortOpen) {
  for ($i = 0; $i -lt 8; $i++) {
    Start-Sleep -Milliseconds 200
    if (Get-AppStatus) { exit 0 }
  }
  Write-Host "[x] Port $port is already used by another program."
  Write-Host "    Change 'port' in config.json (server and launcher both read it), or stop that program."
  exit 2
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[x] Node.js 20+ was not found on PATH.'
  Write-Host '    Install it from https://nodejs.org, then run start.cmd again.'
  exit 3
}

$outLog = Join-Path $logDir 'server.out.log'
$errLog = Join-Path $logDir 'server.err.log'

if ($node.Source -like '*.exe') {
  $proc = Start-Process -FilePath $node.Source -ArgumentList 'server\index.mjs' `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
} else {
  # Version managers ship node as a .cmd shim; CreateProcess cannot run that directly.
  $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$($node.Source)`" server\index.mjs" `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
}

# Wait for the HTTP identity check, not just for a listening socket.
for ($i = 0; $i -lt 100; $i++) {
  Start-Sleep -Milliseconds 150
  if (Get-AppStatus) { exit 0 }
  if ($proc.HasExited) { break }
}

Write-Host '[x] The local server did not start.'
Write-Host "    Log: $errLog"
if (Test-Path $errLog) {
  Get-Content -LiteralPath $errLog -Tail 8 -Encoding UTF8 | ForEach-Object { Write-Host "    $_" }
}
exit 1
