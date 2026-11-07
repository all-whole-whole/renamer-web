# Open the workbench in the system default browser, as an ordinary tab.
#   1. If a browser window already shows this app, bring that window to the front.
#   2. Otherwise hand the URL to the shell: Windows starts the default browser with
#      the profile the user already uses and no extra flags.
#   3. Only when that fails, fall back to a detected Edge/Chrome.
#
# No --app window and no --user-data-dir on purpose. A private profile is a brand new
# browser: its own first-run flow, cache, extension set and permission state, plus a
# second Edge instance next to the real one. Ordinary tabs never show those odd
# behaviours, so both were removed: the page is just http://127.0.0.1:<port>/ in the
# browser the user already trusts.
#
# Exit codes: 0 = focused an existing window or launched a browser, 1 = no browser.
# ASCII only: cmd.exe / PowerShell 5.1 read this file with the OEM/ANSI code page.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$port = 8758
$hostAddr = '127.0.0.1'
try {
  $cfg = Get-Content -Raw -LiteralPath (Join-Path $root 'config.json') | ConvertFrom-Json
  if ($cfg.port) { $port = [int]$cfg.port }
  if ($cfg.host) { $hostAddr = [string]$cfg.host }
} catch { }
$url = "http://${hostAddr}:$port/"

Add-Type -Namespace RwWeb -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsIconic(System.IntPtr hWnd);
'@

function Get-AppStatus {
  try {
    $r = Invoke-RestMethod -Uri "${url}api/ping" -TimeoutSec 1 -ErrorAction Stop
    if ($r.app -eq 'renamer-web') { return $r }
  } catch { }
  return $null
}

function Get-DefaultBrowserPath {
  try {
    $prog = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction Stop).ProgId
    if (-not $prog) { return $null }
    $cmd = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$prog\shell\open\command" -ErrorAction Stop).'(default)'
    if (-not $cmd) { return $null }
    if ($cmd -match '^\s*"([^"]+\.exe)"') { return $matches[1] }
    if ($cmd -match '^\s*(\S+\.exe)') { return $matches[1] }
  } catch { }
  return $null
}

function Get-InstalledBrowser {
  $pf86 = ${env:ProgramFiles(x86)}
  $pf = $env:ProgramFiles
  $la = $env:LOCALAPPDATA
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($pf86) { $candidates.Add((Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe')) }
  if ($pf) { $candidates.Add((Join-Path $pf 'Microsoft\Edge\Application\msedge.exe')) }
  if ($pf) { $candidates.Add((Join-Path $pf 'Google\Chrome\Application\chrome.exe')) }
  if ($la) { $candidates.Add((Join-Path $la 'Google\Chrome\Application\chrome.exe')) }
  if ($pf) { $candidates.Add((Join-Path $pf 'BraveSoftware\Brave-Browser\Application\brave.exe')) }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  return $null
}

# The page title is the only stable handle on our tab from outside the browser: Edge and
# Chrome do not expose their tab list to a script. Read it from index.html instead of
# hard-coding it, so this file stays pure ASCII and follows the page.
$title = $null
try {
  $index = Join-Path $root 'public\index.html'
  $hit = Select-String -LiteralPath $index -Encoding UTF8 -Pattern '<title>\s*(.+?)\s*</title>' -ErrorAction Stop
  if ($hit -and $hit.Matches.Count -gt 0) { $title = $hit.Matches[0].Groups[1].Value.Trim() }
} catch { }

# --- 1) reuse the window that already shows this app ------------------------------
if ($title) {
  $browsers = @('msedge', 'chrome', 'brave', 'vivaldi', 'opera', 'chromium', 'firefox')
  foreach ($name in $browsers) {
    $hits = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object {
      $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.Contains($title)
    }
    foreach ($p in $hits) {
      # Only un-minimize; SW_RESTORE on a maximized Edge window would also un-maximize it.
      if ([RwWeb.Win32]::IsIconic($p.MainWindowHandle)) {
        [RwWeb.Win32]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null   # SW_RESTORE
      }
      [RwWeb.Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
      Write-Host "[i] '$title' is already open; brought that window to the front."
      exit 0
    }
  }
}

# --- 2) hand the URL to the system default browser --------------------------------
$before = Get-AppStatus
if (-not $before) {
  Write-Host '[!] The local host is not answering on this port; the browser may show a connection error.'
}

$default = Get-DefaultBrowserPath
$opened = $false

# ShellExecute on the URL is the literal definition of "default browser"; it also covers
# packaged handlers that would ignore a raw exe path.
try { Start-Process -FilePath $url; $opened = $true } catch { }

if (-not $opened -and $default -and (Test-Path -LiteralPath $default)) {
  try { Start-Process -FilePath $default -ArgumentList $url; $opened = $true } catch { }
}

if (-not $opened) {
  $installed = Get-InstalledBrowser
  if ($installed) {
    try { Start-Process -FilePath $installed -ArgumentList $url; $opened = $true } catch { }
  }
}

if (-not $opened) {
  Write-Host '[x] No browser could be started.'
  Write-Host "    Open this URL manually: $url"
  exit 1
}

if ($default) {
  Write-Host "[i] Opened in the default browser ($([System.IO.Path]::GetFileName($default))): $url"
} else {
  Write-Host "[i] Opened: $url"
}

# --- 3) confirm the new tab really connected (an error page would not) ------------
# clients is the host's live SSE count; only compare when the host reports it.
if ($before -and $null -ne $before.clients) {
  $seen = $false
  for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Milliseconds 250
    $now = Get-AppStatus
    if ($now -and $now.clients -gt $before.clients) { $seen = $true; break }
  }
  if (-not $seen) {
    Write-Host '[!] The browser window opened, but the page has not connected to the host yet.'
    Write-Host '    If the tab shows an error page, close it and run start.cmd again.'
  }
}

exit 0
