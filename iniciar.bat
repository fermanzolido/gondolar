@echo off
title Comparador de super
cd /d "%~dp0"
start "" http://localhost:3210
node server.js
pause
