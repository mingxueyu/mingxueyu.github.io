@echo off
rem ============================================================
rem  Stop the my-blog article manager (default port 4322).
rem
rem  The launcher starts the server WITHOUT a console window, so
rem  there is no window to close -- this finds whatever is listening
rem  on the admin port and stops it.
rem
rem  Usage:  stop launcher            (uses 4322)
rem          stop launcher 4400       (custom port)
rem
rem  Pure ASCII on purpose: cmd.exe mangles non-ASCII comments.
rem ============================================================
setlocal EnableExtensions
set "PORT=4322"
if not "%~1"=="" set "PORT=%~1"

echo.
echo   Stopping my-blog admin (port %PORT%) ...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port=%PORT%;" ^
  "$c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue;" ^
  "if (-not $c) { Write-Host '  [i] Nothing is listening - already stopped.'; exit 0 };" ^
  "$pids = $c | Select-Object -ExpandProperty OwningProcess -Unique;" ^
  "foreach ($procId in $pids) {" ^
  "  try { $p = Get-Process -Id $procId -ErrorAction Stop; Write-Host ('  killing ' + $p.ProcessName + ' (PID ' + $procId + ')'); Stop-Process -Id $procId -Force -ErrorAction Stop }" ^
  "  catch { Write-Host ('  [!] could not stop PID ' + $procId + ': ' + $_.Exception.Message) }" ^
  "};" ^
  "Start-Sleep -Milliseconds 400;" ^
  "if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { Write-Host '  [X] port still busy'; exit 1 } else { Write-Host '  [OK] stopped.'; exit 0 }"

set "RC=%ERRORLEVEL%"
echo.
endlocal & exit /b %RC%
