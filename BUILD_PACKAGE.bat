@echo off
cd /d "%~dp0"
echo.
echo Bygger HyperVision ISE Portal opdateringspakke...
echo.
python make_update_package.py --output dist --verbose
echo.
if %errorlevel% neq 0 (
    echo FEJL: Pakkebygger fejlede.
    pause
    exit /b 1
)
echo Pakken ligger i mappen 'dist\' og er klar til upload.
pause
