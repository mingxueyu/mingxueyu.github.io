@echo off
rem ============================================================
rem  One-click launcher for the my-blog article manager.
rem  Double-click this file (or .vbs for no window).
rem
rem  It only locates Node.js and hands over to
rem  scripts\launch-admin.mjs, which does the real work:
rem  reuse a running instance, start the server detached,
rem  wait for /api/health, then open the browser.
rem
rem  Pure ASCII on purpose: cmd.exe parses this file using the
rem  active code page, so non-ASCII comments can break parsing.
rem ============================================================
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%CD%"
set "PORT=4322"
if not "%~1"=="" set "PORT=%~1"

title my-blog admin %PORT%

rem ---------- locate node ----------
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE (
  for %%P in (
    "%ProgramFiles%\nodejs\node.exe"
    "%ProgramFiles(x86)%\nodejs\node.exe"
    "%LOCALAPPDATA%\Programs\nodejs\node.exe"
  ) do (
    if not defined NODE if exist "%%~P" set "NODE=%%~P"
  )
)
if not defined NODE (
  echo.
  echo   [X] Node.js not found. Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

rem ---------- dependencies (first run) ----------
if not exist "node_modules\vditor\dist\index.min.js" (
  echo.
  echo   [i] Installing dependencies ^(first run, may take a while^) ...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [X] npm install failed. Run it manually in this folder, then retry.
    echo.
    pause
    exit /b 1
  )
)

rem ---------- hand over to the node launcher ----------
"%NODE%" "%ROOT%\scripts\launch-admin.mjs" --port %PORT%
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo   [X] Launcher failed with exit code %RC%.
  echo.
  echo   Try manually:  node admin\server.mjs --port %PORT%
  echo.
  pause
)
exit /b %RC%
