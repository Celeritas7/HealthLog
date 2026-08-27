@echo off
title HealthLog local server
REM Put this .bat in your HealthLog folder (next to index.html)
REM and double-click it. Leave this window open while using the app.
cd /d "%~dp0"

set "ROOT=."
set "PORT=5182"
if not exist "%ROOT%\index.html" (
  echo Could not find index.html here.
  echo Put this .bat in the same folder as HealthLog's index.html
  echo ^(the folder with "HealthLog Desktop v2.dc.html" and support.js^).
  echo Current folder: %CD%
  pause & goto :eof
)

REM --- Find a Python: PATH first, then common Anaconda/Miniconda locations ---
REM (double-clicking uses plain cmd, where conda's PATH is usually NOT active,
REM  so we look for python.exe directly.)
set "PY="
for %%P in (
  "python.exe"
  "%USERPROFILE%\anaconda3\python.exe"
  "%USERPROFILE%\miniconda3\python.exe"
  "%USERPROFILE%\AppData\Local\anaconda3\python.exe"
  "%USERPROFILE%\AppData\Local\miniconda3\python.exe"
  "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
  "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
  "C:\ProgramData\anaconda3\python.exe"
  "C:\ProgramData\miniconda3\python.exe"
) do (
  if not defined PY (
    "%%~P" -c "import sys" >nul 2>nul && set "PY=%%~P"
  )
)

if not defined PY (
  echo.
  echo Could not find Python automatically.
  echo Open "Anaconda Prompt", cd to this folder, and run:
  echo     python -m http.server %PORT% --directory "%ROOT%"
  echo.
  pause & goto :eof
)

echo.
echo   HealthLog - local server
echo   Python:  %PY%
echo   Serving: %ROOT%    Open: http://localhost:%PORT%/
echo   index.html routes to the desktop app; on a phone-size
echo   window it opens the mobile app instead.
echo   Your records save in this browser (localStorage).
echo   (Close this window to stop.)
echo.

start "" "http://localhost:%PORT%/"
"%PY%" -m http.server %PORT% --directory "%ROOT%"

echo.
echo Server stopped.
pause
