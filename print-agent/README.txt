Master Ji Print Agent -- Windows 7 Setup
=========================================

This agent runs on the shop PC and automatically prints receipts
when salesmen tap "Print Bill" on their phones.

REQUIREMENTS
------------
1. Windows 7 (or later)
2. Python 3.8 installed (download: https://www.python.org/downloads/release/python-3817/)
   IMPORTANT: During Python install, CHECK "Add Python to PATH"
3. TVS RP 3200 Star printer connected via USB with driver installed

SETUP (one time)
----------------
1. Install Python 3.8 from the link above
   - Run the installer
   - CHECK the box "Add Python to PATH" at the bottom
   - Click "Install Now"

2. Double-click install.bat
   - This installs required Python packages (requests, pywin32==228)
   - It creates config.ini -- edit it with your settings:
     * url = your Railway app URL
     * agent_token = the PRINT_AGENT_TOKEN you set on Railway
     * name = your printer name (check in Devices and Printers)

3. Set PRINT_AGENT_TOKEN on Railway:
   - Go to Railway dashboard > your app > Variables
   - Add: PRINT_AGENT_TOKEN = (any secret string, e.g. mj-print-secret123)
   - Redeploy the app

RUNNING
-------
Double-click start.bat to start the agent.
It will poll for print jobs every 5 seconds and auto-print them.

To stop: press Ctrl+C in the agent window, or just close it.

AUTO-START ON BOOT
------------------
To make the agent start automatically when the PC turns on:
1. Press Win+R, type: shell:startup, press Enter
2. Copy start.bat into that Startup folder
3. Done -- the agent starts every time Windows boots

TROUBLESHOOTING
---------------
- "Printer not found": Check the printer name in config.ini matches
  exactly what you see in Control Panel > Devices and Printers
- "Cannot reach server": Check internet connection, check the URL
  in config.ini is correct
- "pywin32 not installed": Run install.bat again, or manually:
  pip install pywin32==228
- Light printing: Adjust print density in Printer Preferences
  (Control Panel > Devices and Printers > right-click printer > Preferences)
