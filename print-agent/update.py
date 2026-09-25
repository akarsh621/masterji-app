"""
Downloads the latest print agent files from the Master Ji app on Railway.
Uses the server URL and agent_token from config.ini, so it works even though
the GitHub repo is private. Backs up each file before overwriting.
Does NOT touch config.ini (shop-specific).
"""
import os
import sys
import shutil
import configparser

try:
    import requests
except ImportError:
    print('[ERROR] requests not installed. Run: pip install requests')
    sys.exit(1)

FILES_TO_UPDATE = ['agent.py', 'update.py', 'start.bat']

script_dir = os.path.dirname(os.path.abspath(__file__))


def load_server():
    config_path = os.path.join(script_dir, 'config.ini')
    if not os.path.exists(config_path):
        print('[ERROR] config.ini not found. Run install.bat first.')
        sys.exit(1)
    config = configparser.ConfigParser()
    config.read(config_path)
    return config.get('server', 'url').rstrip('/'), config.get('server', 'agent_token')


def update_file(base_url, token, filename):
    url = '{}/api/print-agent/files/{}'.format(base_url, filename)
    local_path = os.path.join(script_dir, filename)
    backup_path = local_path + '.bak'

    print('Downloading {}...'.format(filename))
    try:
        resp = requests.get(url, headers={'X-Print-Agent-Token': token}, timeout=30)
        if resp.status_code in (401, 403):
            print('[ERROR] Server refused the agent token. Check agent_token in config.ini.')
            return False
        resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        print('[ERROR] Cannot reach the server. Check internet connection.')
        return False
    except Exception as e:
        print('[ERROR] Failed: {}'.format(e))
        return False

    if os.path.exists(local_path):
        shutil.copy2(local_path, backup_path)
        print('  Backed up to {}'.format(os.path.basename(backup_path)))

    with open(local_path, 'wb') as f:
        f.write(resp.content)

    print('  Updated.')
    return True


def main():
    print('=' * 40)
    print('  Master Ji Print Agent Updater')
    print('=' * 40)
    print()

    base_url, token = load_server()
    ok = 0
    for f in FILES_TO_UPDATE:
        if update_file(base_url, token, f):
            ok += 1

    print()
    if ok == len(FILES_TO_UPDATE):
        print('[OK] All files updated. Close the agent window and run start.bat again.')
    else:
        print('[WARN] Some files failed. Check errors above.')


if __name__ == '__main__':
    main()
