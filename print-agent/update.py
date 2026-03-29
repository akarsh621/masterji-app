"""
Downloads the latest agent.py from GitHub.
Backs up current agent.py before overwriting.
Does NOT touch config.ini (shop-specific).
"""
import os
import sys
import shutil

try:
    import requests
except ImportError:
    print('[ERROR] requests not installed. Run: pip install requests')
    sys.exit(1)

REPO_RAW = 'https://raw.githubusercontent.com/akarsh621/masterji-app/main/print-agent'
FILES_TO_UPDATE = ['agent.py']

script_dir = os.path.dirname(os.path.abspath(__file__))


def update_file(filename):
    url = '{}/{}'.format(REPO_RAW, filename)
    local_path = os.path.join(script_dir, filename)
    backup_path = local_path + '.bak'

    print('Downloading {}...'.format(filename))
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print('[ERROR] Failed to download {}: {}'.format(filename, e))
        return False

    if os.path.exists(local_path):
        shutil.copy2(local_path, backup_path)
        print('  Backed up to {}'.format(os.path.basename(backup_path)))

    with open(local_path, 'wb') as f:
        f.write(resp.content)

    print('  Updated successfully!')
    return True


def main():
    print('=' * 40)
    print('  Master Ji Print Agent Updater')
    print('=' * 40)
    print()

    ok = 0
    for f in FILES_TO_UPDATE:
        if update_file(f):
            ok += 1

    print()
    if ok == len(FILES_TO_UPDATE):
        print('[OK] All files updated. Restart the agent to use the new version.')
    else:
        print('[WARN] Some files failed to update. Check errors above.')


if __name__ == '__main__':
    main()
