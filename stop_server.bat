@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

set "PORT=8000"
set "RUNTIME_DIR=%CD%\.runtime"
set "PID_FILE=%RUNTIME_DIR%\http-server.pid"
set "STOPPED="

if exist "%PID_FILE%" (
  set /p SERVER_PID=<"%PID_FILE%"
  if defined SERVER_PID (
    tasklist /FI "PID eq !SERVER_PID!" | find "!SERVER_PID!" >nul
    if not errorlevel 1 (
      echo Stopping dashboard service PID !SERVER_PID!...
      taskkill /PID !SERVER_PID! /T /F >nul 2>nul
      if not errorlevel 1 set "STOPPED=1"
    )
  )
  del "%PID_FILE%" >nul 2>nul
)

if not defined STOPPED (
  set "LISTEN_PID="
  for /f %%P in ('powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1)"') do set "LISTEN_PID=%%P"
  if defined LISTEN_PID (
    echo Stopping process on port %PORT% with PID !LISTEN_PID!...
    taskkill /PID !LISTEN_PID! /T /F >nul 2>nul
    if not errorlevel 1 set "STOPPED=1"
  )
)

if defined STOPPED (
  echo Dashboard service on port %PORT% has been stopped.
) else (
  echo No running dashboard service found on port %PORT%.
)

exit /b 0
