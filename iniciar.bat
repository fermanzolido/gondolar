@echo off
title Gondolar
cd /d "%~dp0"
if not exist "public\data\meta.json" (
  echo Descargando los precios oficiales de SEPA ^(unos 300 MB, tarda un par de minutos^)...
  python scripts\build_sepa.py --download --out public\data
  if errorlevel 1 (
    echo.
    echo No pude preparar los datos. Hace falta Python 3 instalado: https://www.python.org
    pause
    exit /b 1
  )
)
start "" http://localhost:3210
node server.js
pause
