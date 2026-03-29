"""
Master Ji Fashion House -- Print Agent for Windows 7
Polls the Railway-hosted app for pending print jobs and sends
receipts to the TVS RP 3200 Star thermal printer via ESC/POS.
"""

import time
import sys
import os
import configparser
import requests

try:
    import win32print
except ImportError:
    print("[ERROR] pywin32 not installed. Run: pip install pywin32==228")
    sys.exit(1)

# ── ESC/POS Commands ──────────────────────────────────────────────

ESC = b'\x1b'
GS = b'\x1d'

INIT = ESC + b'@'
BOLD_ON = ESC + b'E\x01'
BOLD_OFF = ESC + b'E\x00'
DSTRIKE_ON = ESC + b'G\x01'
DSTRIKE_OFF = ESC + b'G\x00'
CENTER = ESC + b'a\x01'
LEFT = ESC + b'a\x00'
RIGHT = ESC + b'a\x02'
DOUBLE_HEIGHT_ON = ESC + b'!\x10'
DOUBLE_HEIGHT_OFF = ESC + b'!\x00'
DOUBLE_WIDTH_ON = ESC + b'!\x20'
DOUBLE_BOTH_ON = ESC + b'!\x30'
NORMAL = ESC + b'!\x00'
CUT = GS + b'V\x00'
FEED_3 = ESC + b'd\x03'

def qr_code_bytes(data):
    """Build ESC/POS commands to print a QR code."""
    encoded = data.encode('utf-8')
    store_len = len(encoded) + 3
    store_pL = store_len & 0xFF
    store_pH = (store_len >> 8) & 0xFF
    buf = bytearray()
    buf += GS + b'(k\x04\x00\x311\x32\x00'       # QR model 2
    buf += GS + b'(k\x03\x00\x31C\x06'             # QR size 6 (medium-large)
    buf += GS + b'(k\x03\x00\x31E1'                # Error correction level L
    buf += GS + b'(k' + bytes([store_pL, store_pH]) + b'\x31P0' + encoded  # Store data
    buf += GS + b'(k\x03\x00\x31Q0'                # Print QR
    return bytes(buf)
LINE_WIDTH = 42
LINE = b'-' * LINE_WIDTH + b'\n'
DOUBLE_LINE = b'=' * LINE_WIDTH + b'\n'

def encode(text):
    return text.encode('cp437', errors='replace')

def _indian_format(n):
    """Format number with Indian comma grouping (1,23,456)."""
    n = int(round(n))
    s = str(abs(n))
    result = ''
    if len(s) > 3:
        result = s[-3:]
        s = s[:-3]
        while s:
            result = s[-2:] + ',' + result if len(s) >= 2 else s + ',' + result
            s = s[:-2]
    else:
        result = s
    prefix = '-' if n < 0 else ''
    return prefix + result

def rupees(n):
    return 'Rs ' + _indian_format(n)

def rupees_bare(n):
    return _indian_format(n)


# ── Receipt Builder ───────────────────────────────────────────────

def build_receipt(job):
    """Build ESC/POS byte sequence for a receipt."""
    buf = bytearray()
    buf += INIT
    buf += BOLD_ON + DSTRIKE_ON

    # ── Shop Header (biggest possible: double-height + double-width) ──
    buf += DOUBLE_LINE
    buf += CENTER + DOUBLE_BOTH_ON
    buf += encode('MASTER JI\n')
    buf += encode('FASHION HOUSE\n')
    buf += NORMAL + BOLD_ON + DSTRIKE_ON
    buf += encode('C Block, Main Market Road\n')
    buf += encode('Shastri Nagar, Ghaziabad\n')
    buf += encode('Ph: 9540664066 / 0120-4245977\n')
    buf += DOUBLE_LINE

    # ── Bill info (one line: bill number left, date right) ──
    buf += LEFT
    bill_num = job.get('bill_number', '')
    date_str = format_date(job.get('created_at', ''))
    gap = LINE_WIDTH - len(bill_num) - len(date_str)
    if gap < 1:
        gap = 1
    buf += encode('{}{}{}\n'.format(bill_num, ' ' * gap, date_str))
    salesman = job.get('salesman_name', '')
    if salesman:
        buf += encode('Salesman: {}\n'.format(salesman))
    buf += LINE

    # ── Items ──
    buf += encode('{:<24s}{:>6s}{:>12s}\n'.format('Item', 'Qty', 'Rs'))
    buf += LINE

    items = job.get('items', [])
    for item in items:
        name = item.get('category_name', 'Item')[:24]
        qty = item.get('quantity', 1)
        amt = int(round(item.get('amount', 0)))
        buf += encode('{:<24s}{:>6d}{:>12s}\n'.format(
            name, qty, rupees_bare(amt)
        ))
    buf += LINE

    # ── Discount Given ──
    mrp_total = job.get('mrp_total', 0)
    total = job.get('total', 0)
    saved = int(round(mrp_total - total)) if mrp_total else 0

    if saved > 0:
        buf += encode('{:<24s}{:>18s}\n'.format('Discount Given', '- ' + rupees(saved)))

    # ── TOTAL (double-height + double-width for max emphasis) ──
    buf += DOUBLE_LINE
    buf += DOUBLE_BOTH_ON
    buf += encode('{:<10s}{:>11s}\n'.format('TOTAL', rupees(total)))
    buf += NORMAL + BOLD_ON + DSTRIKE_ON
    buf += DOUBLE_LINE

    # ── Payment ──
    payments = job.get('payments', [])
    if len(payments) > 1:
        for p in payments:
            mode = p.get('mode', '').upper()
            amt = int(round(p.get('amount', 0)))
            buf += encode('{:<24s}{:>18s}\n'.format(mode, rupees(amt)))
    else:
        mode = (job.get('payment_mode', '') or 'cash').upper()
        buf += CENTER
        buf += encode('Payment: {}\n'.format(mode))
        buf += LEFT

    notes = job.get('notes', '')
    if notes:
        buf += encode('\nNote: {}\n'.format(notes))

    buf += LINE

    # ── Footer ──
    buf += CENTER
    buf += encode('Exchange / Return sirf 7 din mein\n')
    buf += LINE
    buf += b'\n'
    buf += DOUBLE_HEIGHT_ON
    buf += encode('Thank You For Shopping!\n')
    buf += NORMAL + BOLD_ON + DSTRIKE_ON
    buf += encode('Naye kapdo me jach rahe ho,\n')
    buf += encode('phir zarur aana :)\n')
    buf += b'\n'
    buf += qr_code_bytes('https://g.page/r/Cdj1aJR-po6TEBI/review')
    buf += b'\n'
    buf += encode('Accha laga to Google pe\n')
    buf += encode('ek review de dena\n')

    buf += DOUBLE_LINE
    buf += LEFT
    buf += BOLD_OFF + DSTRIKE_OFF
    buf += FEED_3
    buf += CUT

    return bytes(buf)


def format_date(date_str):
    if not date_str:
        return ''
    try:
        from datetime import datetime
        dt = datetime.strptime(date_str[:19], '%Y-%m-%d %H:%M:%S')
        months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        hour = dt.hour % 12 or 12
        ampm = 'PM' if dt.hour >= 12 else 'AM'
        return '{} {} {}  {}:{:02d} {}'.format(
            dt.day, months[dt.month], dt.year, hour, dt.minute, ampm
        )
    except Exception:
        return date_str


# ── Printer ───────────────────────────────────────────────────────

JOB_STATUS_ERROR   = 0x00000002
JOB_STATUS_OFFLINE = 0x00000020
JOB_STATUS_PAPEROUT = 0x00000040
JOB_STATUS_BLOCKED = 0x00000200
JOB_STATUS_USER_INTERVENTION = 0x00000400
JOB_STATUS_STUCK = (JOB_STATUS_ERROR | JOB_STATUS_OFFLINE |
                    JOB_STATUS_PAPEROUT | JOB_STATUS_BLOCKED |
                    JOB_STATUS_USER_INTERVENTION)


def flush_spooler(printer_name):
    """Cancel stuck/error jobs in the Windows spooler for this printer only."""
    try:
        hprinter = win32print.OpenPrinter(printer_name)
        try:
            jobs = win32print.EnumJobs(hprinter, 0, 100, 1)
            cleared = 0
            for job in jobs:
                status = job.get('Status', 0)
                if status & JOB_STATUS_STUCK:
                    try:
                        win32print.SetJob(hprinter, job['JobId'],
                                          0, None, win32print.JOB_CONTROL_DELETE)
                        cleared += 1
                    except Exception:
                        pass
            if cleared:
                print('[SPOOLER] Cleared {} stuck job(s)'.format(cleared))
        finally:
            win32print.ClosePrinter(hprinter)
    except Exception as e:
        print('[SPOOLER] Warning: {}'.format(e))


def send_to_printer(printer_name, data):
    """Send raw bytes to a Windows printer."""
    hprinter = win32print.OpenPrinter(printer_name)
    try:
        win32print.StartDocPrinter(hprinter, 1, ("MasterJi Receipt", None, "RAW"))
        win32print.StartPagePrinter(hprinter)
        win32print.WritePrinter(hprinter, data)
        win32print.EndPagePrinter(hprinter)
        win32print.EndDocPrinter(hprinter)
    finally:
        win32print.ClosePrinter(hprinter)


# ── API Client ────────────────────────────────────────────────────

class PrintAgentAPI:
    def __init__(self, base_url, token):
        self.base_url = base_url.rstrip('/')
        self.headers = {'X-Print-Agent-Token': token}

    def get_pending_jobs(self):
        url = '{}/api/print-queue?status=pending'.format(self.base_url)
        resp = requests.get(url, headers=self.headers, timeout=15)
        resp.raise_for_status()
        return resp.json()

    def update_job_status(self, queue_id, status):
        url = '{}/api/print-queue/{}'.format(self.base_url, queue_id)
        resp = requests.patch(url, json={'status': status},
                              headers=self.headers, timeout=15)
        resp.raise_for_status()
        return resp.json()


# ── Main Loop ─────────────────────────────────────────────────────

def load_config():
    config = configparser.ConfigParser()
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.ini')
    if not os.path.exists(config_path):
        print('[ERROR] config.ini not found at {}'.format(config_path))
        print('        Copy config.example.ini to config.ini and fill in your values.')
        sys.exit(1)
    config.read(config_path)
    return config


def main():
    config = load_config()

    base_url = config.get('server', 'url')
    token = config.get('server', 'agent_token')
    printer_name = config.get('printer', 'name')
    poll_interval = config.getint('agent', 'poll_seconds', fallback=5)

    # --clear flag: wipe all pending jobs and exit
    if '--clear' in sys.argv:
        try:
            resp = requests.delete(
                '{}/api/print-queue'.format(base_url.rstrip('/')),
                headers={'X-Print-Agent-Token': token},
                timeout=15
            )
            resp.raise_for_status()
            data = resp.json()
            print('[OK] Cleared {} pending job(s)'.format(data.get('cleared', 0)))
        except Exception as e:
            print('[ERROR] Clear failed: {}'.format(e))
        sys.exit(0)

    print('=' * 50)
    print('  Master Ji Print Agent')
    print('  Server: {}'.format(base_url))
    print('  Printer: {}'.format(printer_name))
    print('  Poll interval: {}s'.format(poll_interval))
    print('=' * 50)

    printers = [p[2] for p in win32print.EnumPrinters(
        win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    )]
    if printer_name not in printers:
        print('[ERROR] Printer "{}" not found!'.format(printer_name))
        print('        Available printers:')
        for p in printers:
            print('          - {}'.format(p))
        sys.exit(1)

    print('[OK] Printer "{}" found'.format(printer_name))
    print('[OK] Agent started. Polling for print jobs...\n')

    api = PrintAgentAPI(base_url, token)
    consecutive_errors = 0

    while True:
        try:
            jobs = api.get_pending_jobs()
            consecutive_errors = 0

            if not jobs:
                pass  # No pending jobs, silent
            else:
                print('[INFO] {} pending job(s) found'.format(len(jobs)))

            for job in jobs:
                queue_id = job.get('queue_id')
                bill_number = job.get('bill_number', '?')

                try:
                    # Mark as printing
                    api.update_job_status(queue_id, 'printing')

                    # Clear any stuck spooler jobs, then print
                    flush_spooler(printer_name)
                    receipt_data = build_receipt(job)
                    send_to_printer(printer_name, receipt_data)

                    # Mark as printed
                    api.update_job_status(queue_id, 'printed')
                    print('[DONE] {} printed successfully'.format(bill_number))

                except Exception as e:
                    print('[FAIL] {} failed: {}'.format(bill_number, e))
                    try:
                        api.update_job_status(queue_id, 'failed')
                    except Exception:
                        pass

        except requests.exceptions.ConnectionError:
            consecutive_errors += 1
            if consecutive_errors == 1:
                print('[WARN] Cannot reach server. Retrying...')
        except requests.exceptions.Timeout:
            consecutive_errors += 1
            if consecutive_errors == 1:
                print('[WARN] Server timeout. Retrying...')
        except Exception as e:
            consecutive_errors += 1
            if consecutive_errors <= 3:
                print('[ERROR] {}'.format(e))

        time.sleep(poll_interval)


if __name__ == '__main__':
    main()
