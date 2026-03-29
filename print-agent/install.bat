@echo off
echo ==========================================
echo   Master Ji Print Agent - Setup
echo ==========================================
echo.

echo Installing Python packages...
pip install requests pywin32==228
echo.

if not exist config.ini (
    echo Creating config.ini from template...
    copy config.example.ini config.ini
    echo.
    echo ** IMPORTANT: Edit config.ini with your settings before running the agent **
    echo    - Set your Railway URL
    echo    - Set your PRINT_AGENT_TOKEN
    echo    - Set your printer name
    echo.
    notepad config.ini
) else (
    echo config.ini already exists.
)

echo.
echo Setup complete! Run start.bat to start the agent.
pause
