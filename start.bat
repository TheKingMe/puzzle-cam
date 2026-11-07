@echo off
title Puzzle-Cam Server
echo ========================================================
echo Starting Puzzle-Cam Local Server...
echo ========================================================
echo.
echo Opening http://localhost:8000 in your default browser...
start http://localhost:8000
python -m http.server 8000
pause
