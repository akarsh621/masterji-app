Master Ji Print Agent -- Windows 7 Setup
=========================================

This agent runs on the shop PC. It:
  - prints receipts when salesmen tap "Print Bill" on their phones
  - saves a copy of the shop database on this PC once a day (backups folder)
  - restarts itself automatically if it ever stops

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
   - Generate a long random value, e.g. on a Mac/Linux: openssl rand -hex 32
   - Railway dashboard > your app > Variables > PRINT_AGENT_TOKEN = (that value)
   - Put the SAME value in config.ini as agent_token
   - Redeploy the app
   If the two values don't match, nothing prints.

RUNNING
-------
Double-click start.bat. It polls for print jobs every 5 seconds.
If the agent stops for any reason, start.bat restarts it after 10 seconds.
To stop it: close the agent window.

AUTO-START ON BOOT
------------------
1. Press Win+R, type: shell:startup, press Enter
2. Copy start.bat into that Startup folder
3. Done -- the agent starts every time Windows boots

UPDATING THE AGENT
------------------
Double-click update.bat, then close the agent window and run start.bat again.
Updates are downloaded from the Railway app itself (using agent_token from
config.ini), so they keep working even though the code repository is private.
Each updated file's previous version is kept as <file>.bak.

BACKUPS
-------
Once a day the agent saves a full copy of the shop database into the
"backups" folder next to agent.py (masterji-YYYY-MM-DD_HHMM.db), keeping
the last 30. This is the only copy stored outside Railway -- don't delete
the folder. Settings are in the [backup] section of config.ini.

TROUBLESHOOTING
---------------
- "Printer not found": Check the printer name in config.ini matches
  exactly what you see in Control Panel > Devices and Printers
- "Cannot reach server": Check internet connection, check the URL
  in config.ini is correct
- "[BACKUP] Failed": usually no internet; it retries every 10 minutes
- "pywin32 not installed": Run install.bat again, or manually:
  pip install pywin32==228
- Light printing: Adjust print density in Printer Preferences
  (Control Panel > Devices and Printers > right-click printer > Preferences)
