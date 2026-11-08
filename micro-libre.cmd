@echo off
rem Doble clic para arrancar micro-libre.
where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas Node.js 20 o superior: https://nodejs.org
  pause
  exit /b 1
)
node "%~dp0src\server.js" %*
if errorlevel 1 pause
