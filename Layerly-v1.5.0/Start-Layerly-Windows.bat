@echo off
cd /d "%~dp0"
echo Layerly - Starting local link-to-design app
where py >nul 2>nul
if %errorlevel%==0 (set "PY=py -3") else (set "PY=python")
if not exist .venv %PY% -m venv .venv
if not exist .venv\Scripts\python.exe (echo Please install Python 3 from python.org & pause & exit /b 1)
.venv\Scripts\python.exe -c "import playwright; from PIL import Image" >nul 2>nul
if errorlevel 1 (
  echo Installing dependency (first run only)...
  .venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
)
.venv\Scripts\python.exe server.py
pause
