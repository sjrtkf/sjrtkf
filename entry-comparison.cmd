@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is missing. Run npm ci in this folder first.
  pause
  exit /b 1
)
"node_modules\electron\dist\electron.exe" "src\request-probe.js"
