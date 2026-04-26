@echo off
setlocal

cd /d "%~dp0"

set "PORT=8000"
set "HOST=127.0.0.1"
set "URL=http://127.0.0.1:8000/starred_repos_dashboard.html"
set "SERVER_COMMAND=python server.py 8000"
set "RUNTIME_DIR=%CD%\.runtime"
set "PID_FILE=%RUNTIME_DIR%\http-server.pid"
set "OUT_LOG=%RUNTIME_DIR%\http-server.out.log"
set "ERR_LOG=%RUNTIME_DIR%\http-server.err.log"

if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%"

set "LISTEN_PID="
for /f %%P in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1)"') do set "LISTEN_PID=%%P"
if defined LISTEN_PID (
  echo Port %PORT% is already in use by PID %LISTEN_PID%.
  echo Run stop_server.bat first if you want to restart the local dashboard service.
  start "" "%URL%"
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found in PATH.
  exit /b 1
)

echo Starting: %SERVER_COMMAND%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$proc = Start-Process -FilePath 'python' -ArgumentList 'server.py','%PORT%' -WorkingDirectory '%CD%' -WindowStyle Minimized -RedirectStandardOutput '%OUT_LOG%' -RedirectStandardError '%ERR_LOG%' -PassThru; Set-Content -Path '%PID_FILE%' -Value $proc.Id"
if errorlevel 1 (
  echo Failed to start the local dashboard service.
  exit /b 1
)

timeout /t 2 /nobreak >nul
start "" "%URL%"
echo Dashboard service started at %URL%
echo PID saved to %PID_FILE%

exit /b 0
