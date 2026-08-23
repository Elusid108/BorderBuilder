@echo off
title BorderBuilder Dev Server

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 goto :no_node

if not exist "node_modules\" goto :install
goto :run

:install
echo Installing dependencies on first run...
call npm install
if errorlevel 1 goto :install_failed
goto :run

:run
echo.
echo Starting BorderBuilder dev server...
echo Browser will open at http://localhost:5173/BorderBuilder/
echo Press Ctrl+C in this window to stop the server.
echo.
call npm run dev -- --open /BorderBuilder/
echo.
echo Dev server stopped.
pause
exit /b 0

:no_node
echo.
echo [ERROR] Node.js / npm not found on PATH.
echo Install Node.js LTS from https://nodejs.org and try again.
echo.
pause
exit /b 1

:install_failed
echo.
echo [ERROR] npm install failed. See messages above.
echo.
pause
exit /b 1
