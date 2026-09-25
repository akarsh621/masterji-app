@echo off
REM Keeps the print agent running: if it ever stops, it restarts after 10 seconds.
REM Close this window to stop the agent.
:loop
echo Starting Master Ji Print Agent...
python "%~dp0agent.py"
echo.
echo Agent stopped. Restarting in 10 seconds... (close this window to stop)
timeout /t 10 /nobreak >nul
goto loop
