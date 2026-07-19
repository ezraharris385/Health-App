@echo off
REM Windows: double-click this file to start the Health app.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet.
  echo Install it from https://nodejs.org ^(big green button, then Next-Next-Finish^),
  echo then double-click this file again.
  pause
  exit /b 1
)

if not exist .env (
  echo One-time setup: the AI assistants need an Anthropic API key.
  echo ^(Get one at https://platform.claude.com — or press Enter to skip for now;
  echo everything except the AI chats works without it.^)
  set /p KEY="Paste your API key: "
  echo ANTHROPIC_API_KEY=!KEY!> .env
)

if not exist node_modules (
  echo First run: downloading the app's components ^(a few minutes^)...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist client\dist (
  echo First run: building the app...
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)

echo.
echo ================================================================
echo   Starting the Health app. LEAVE THIS WINDOW OPEN while using it.
echo   On your phone ^(same Wi-Fi^), open the "on your phone" address
echo   shown below, then Add to Home Screen in your browser menu.
echo ================================================================
echo.
call npm start
pause
