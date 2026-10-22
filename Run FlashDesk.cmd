@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo This is the developer launcher and requires Node.js.
  echo For normal use, run FlashDesk Player Setup 1.0.4.exe instead.
  echo The installed app does not require Node.js.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Setting up FlashDesk Player for first launch...
  call npm install
  if errorlevel 1 (
    echo Setup failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

call npm start
endlocal
