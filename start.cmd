@echo off
rem renamer-web launcher -- local browser only (no Electron, no bundled Chromium).
rem   step 1: make sure the Node host for this folder is running
rem   step 2: focus the window that already shows the app, or open the page in the
rem           system default browser (a normal tab, no --app window, no private profile)
rem Keep this file pure ASCII: cmd.exe parses .cmd with the OEM code page.
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no_node

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\launch-server.ps1"
if errorlevel 3 goto :no_node
if errorlevel 2 goto :port_busy
if errorlevel 1 goto :no_server

powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\open-app.ps1"
if errorlevel 1 goto :no_browser

exit /b 0

:no_node
echo [!] Node.js 20+ is required but was not found on PATH.
echo     Install it from https://nodejs.org, then run start.cmd again.
pause
exit /b 1

:port_busy
echo [!] The configured port is already used by another program.
echo     Edit "port" in config.json, then run start.cmd again.
pause
exit /b 1

:no_server
echo [!] The local server did not start. See .tmp\logs\server.err.log
echo     Manual run: node server\index.mjs
pause
exit /b 1

:no_browser
echo [!] Could not open the system default browser.
echo     Open this URL manually, or run:
echo     powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-app.ps1"
pause
exit /b 1
