@echo off
title Document Graph Explorer

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on your PATH.
  echo Install it from https://nodejs.org/ and try again.
  pause
  exit /b 1
)

node "%~dp0scripts\serve.mjs"
if errorlevel 1 (
  echo.
  echo Document Graph Explorer exited with an error ^(see above^).
  pause
)
