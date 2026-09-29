@echo off
rem Actualiza los datos de precios (SEPA) y republica la web. Lo usa la tarea programada de Windows "Gondolar - actualizar datos".
rem Necesita Node.js, Python y GitHub CLI (gh) con la sesion iniciada, y una conexion con IP argentina.
rem Deja un registro en %LOCALAPPDATA%\Gondolar\publicar-datos.log
setlocal
set "CARPETA=%LOCALAPPDATA%\Gondolar"
if not exist "%CARPETA%" mkdir "%CARPETA%"
set "LOG=%CARPETA%\publicar-datos.log"
cd /d "%~dp0.."
echo. >> "%LOG%"
echo ===== %DATE% %TIME% ===== >> "%LOG%"
call npm run publicar-datos >> "%LOG%" 2>&1
set "RESULTADO=%ERRORLEVEL%"
echo Resultado: %RESULTADO% >> "%LOG%"
exit /b %RESULTADO%
