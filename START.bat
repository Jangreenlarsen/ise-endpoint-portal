@echo off
cd /d "%~dp0"
:start
echo.
echo ============================================================
echo  HyperVision ISE Portal — starter...
echo  Tryk Ctrl+C for at stoppe permanent
echo ============================================================
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
echo.
echo Server stoppet. Venter 3 sekunder inden genstart...
echo Tryk Ctrl+C nu for at afbryde genstart.
timeout /t 3 /nobreak >nul 2>&1
if %errorlevel% equ 0 goto start
echo Afbrudt.
