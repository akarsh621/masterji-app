"""
Master Ji Fashion House -- Print Agent for Windows 7
Polls the Railway-hosted app for pending print jobs and sends
receipts to the TVS RP 3200 Star thermal printer.
Supports two modes: 'raw' (ESC/POS) and 'html' (via Windows printer driver).
"""

import time
import sys
import os
import subprocess
import configparser
import requests

try:
    import win32print
    import win32api
except ImportError:
    print("[ERROR] pywin32 not installed. Run: pip install pywin32==228")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RECEIPT_HTML_PATH = os.path.join(SCRIPT_DIR, '_receipt.html')
GOOGLE_REVIEW_URL = 'https://g.page/r/Cdj1aJR-po6TEBI/review'
QR_IMG_URL = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + GOOGLE_REVIEW_URL.replace(':', '%3A').replace('/', '%2F')


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
    buf += GS + b'(k\x04\x00\x311\x32\x00'
    buf += GS + b'(k\x03\x00\x31C\x06'
    buf += GS + b'(k\x03\x00\x31E1'
    buf += GS + b'(k' + bytes([store_pL, store_pH]) + b'\x31P0' + encoded
    buf += GS + b'(k\x03\x00\x31Q0'
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

def rupees_html(n):
    return '&#8377;' + _indian_format(n)


# ── Date Formatting ──────────────────────────────────────────────

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


# ── RAW ESC/POS Receipt Builder ──────────────────────────────────

def build_receipt(job):
    """Build ESC/POS byte sequence for a receipt."""
    buf = bytearray()
    buf += INIT
    buf += BOLD_ON + DSTRIKE_ON

    buf += DOUBLE_LINE
    buf += CENTER + DOUBLE_BOTH_ON
    buf += encode('MASTER JI\n')
    buf += encode('FASHION HOUSE\n')
    buf += NORMAL + BOLD_ON + DSTRIKE_ON
    buf += encode('C Block, Main Market Road\n')
    buf += encode('Shastri Nagar, Ghaziabad\n')
    buf += encode('Ph: 9540664066 / 0120-4245977\n')
    buf += DOUBLE_LINE

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

    mrp_total = job.get('mrp_total', 0)
    total = job.get('total', 0)
    saved = int(round(mrp_total - total)) if mrp_total else 0

    if saved > 0:
        buf += encode('{:<24s}{:>18s}\n'.format('Discount on MRP', rupees(saved)))

    buf += DOUBLE_LINE
    buf += DOUBLE_BOTH_ON
    buf += encode('{:<10s}{:>11s}\n'.format('TOTAL', rupees(total)))
    buf += NORMAL + BOLD_ON + DSTRIKE_ON
    buf += DOUBLE_LINE

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

    buf += CENTER
    buf += encode('Exchange / Return sirf 7 din mein\n')
    buf += LINE
    buf += b'\n'
    buf += DOUBLE_HEIGHT_ON
    buf += encode('Thank You For Shopping!\n')
    buf += b'\n'
    buf += encode('Naye kapdo me jach rahe ho,\n')
    buf += encode('phir zarur aana :)\n')
    buf += NORMAL + BOLD_ON + DSTRIKE_ON
    buf += b'\n'
    buf += qr_code_bytes(GOOGLE_REVIEW_URL)
    buf += b'\n'
    buf += encode('Accha laga to upar QR scan karein\n')
    buf += encode('Ek review zarur dein\n')

    buf += DOUBLE_LINE
    buf += LEFT
    buf += BOLD_OFF + DSTRIKE_OFF
    buf += FEED_3
    buf += CUT

    return bytes(buf)


# ── HTML Receipt Builder ─────────────────────────────────────────

def build_receipt_html(job):
    """Build HTML receipt string (same layout as browser version)."""
    bill_num = job.get('bill_number', '')
    date_str = format_date(job.get('created_at', ''))
    salesman = job.get('salesman_name', '')
    total = job.get('total', 0)
    mrp_total = job.get('mrp_total', 0)
    saved = int(round(mrp_total - total)) if mrp_total else 0
    notes = job.get('notes', '')
    items = job.get('items', [])
    payments = job.get('payments', [])
    payment_mode = (job.get('payment_mode', '') or 'cash').upper()

    items_rows = ''
    for item in items:
        name = item.get('category_name', 'Item')
        qty = item.get('quantity', 1)
        amt = int(round(item.get('amount', 0)))
        items_rows += (
            '<tr>'
            '<td style="text-align:left">{}</td>'
            '<td style="text-align:center">{}</td>'
            '<td style="text-align:right">{}</td>'
            '</tr>\n'
        ).format(name, qty, rupees_html(amt))

    if len(payments) > 1:
        payment_html = '<div style="margin-top:6px">'
        for p in payments:
            mode = p.get('mode', '').upper()
            amt = int(round(p.get('amount', 0)))
            payment_html += (
                '<div style="display:flex;justify-content:space-between">'
                '<span>{}</span><span>{}</span>'
                '</div>'
            ).format(mode, rupees_html(amt))
        payment_html += '</div>'
    else:
        payment_html = '<div style="margin-top:6px;text-align:center">Payment: {}</div>'.format(payment_mode)

    notes_html = ''
    if notes:
        notes_html = '<div style="margin-top:4px;font-size:13px;color:#000">Note: {}</div>'.format(notes)

    discount_html = ''
    if saved > 0:
        discount_html = (
            '<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:900">'
            '<span>Discount on MRP</span>'
            '<span>{}</span>'
            '</div>'
        ).format(rupees_html(saved))

    salesman_html = ''
    if salesman:
        salesman_html = '<div style="font-size:13px">Salesman: {}</div>'.format(salesman)

    html = (
        '<!DOCTYPE html>\n'
        '<html>\n'
        '<head>\n'
        '<meta charset="utf-8">\n'
        '<title>Receipt {bill_num}</title>\n'
        '<style>\n'
        '  @page {{ size: 80mm auto; margin: 2mm; }}\n'
        '  * {{ margin: 0; padding: 0; box-sizing: border-box; }}\n'
        '  body {{\n'
        '    font-family: Arial, Helvetica, sans-serif;\n'
        '    font-size: 15px;\n'
        '    font-weight: bold;\n'
        '    line-height: 1.4;\n'
        '    width: 76mm;\n'
        '    max-width: 76mm;\n'
        '    color: #000;\n'
        '    -webkit-print-color-adjust: exact;\n'
        '    print-color-adjust: exact;\n'
        '  }}\n'
        '  .receipt {{ padding: 2mm; }}\n'
        '  .center {{ text-align: center; }}\n'
        '  .bold {{ font-weight: 900; }}\n'
        '  .divider {{ border-top: 1px dashed #000; margin: 8px 0; }}\n'
        '  .double-divider {{ border-top: 3px solid #000; margin: 8px 0; }}\n'
        '  table {{ width: 100%; border-collapse: collapse; }}\n'
        '  th {{ padding: 4px 0; font-size: 13px; font-weight: 900; border-bottom: 2px solid #000; }}\n'
        '  td {{ padding: 4px 0; font-size: 14px; font-weight: bold; }}\n'
        '  .total-row {{ font-size: 20px; font-weight: 900; }}\n'
        '</style>\n'
        '</head>\n'
        '<body>\n'
        '<div class="receipt">\n'
        '  <div class="double-divider"></div>\n'
        '  <div class="center bold" style="font-size:22px;letter-spacing:1px">MASTER JI<br>FASHION HOUSE</div>\n'
        '  <div class="center" style="font-size:12px;margin-top:3px">C Block, Main Market Road<br>Shastri Nagar, Ghaziabad</div>\n'
        '  <div class="center" style="font-size:12px">Ph: 9540664066 / 0120-4245977</div>\n'
        '  <div class="double-divider"></div>\n'
        '\n'
        '  <div style="display:flex;justify-content:space-between">\n'
        '    <span class="bold">{bill_num}</span>\n'
        '    <span style="font-size:13px">{date_str}</span>\n'
        '  </div>\n'
        '  {salesman_html}\n'
        '  <div class="divider"></div>\n'
        '\n'
        '  <table>\n'
        '    <thead>\n'
        '      <tr>\n'
        '        <th style="text-align:left">Item</th>\n'
        '        <th style="text-align:center">Qty</th>\n'
        '        <th style="text-align:right">Rs</th>\n'
        '      </tr>\n'
        '    </thead>\n'
        '    <tbody>\n'
        '      {items_rows}\n'
        '    </tbody>\n'
        '  </table>\n'
        '  <div class="divider"></div>\n'
        '\n'
        '  {discount_html}\n'
        '\n'
        '  <div class="double-divider"></div>\n'
        '  <div style="display:flex;justify-content:space-between" class="total-row">\n'
        '    <span>TOTAL</span>\n'
        '    <span>{total_html}</span>\n'
        '  </div>\n'
        '  <div class="divider"></div>\n'
        '\n'
        '  {payment_html}\n'
        '  {notes_html}\n'
        '  <div class="divider"></div>\n'
        '\n'
        '  <div class="center" style="font-size:13px;margin-top:6px">\n'
        '    Exchange / Return sirf 7 din mein\n'
        '  </div>\n'
        '  <div class="divider"></div>\n'
        '  <div class="center bold" style="margin-top:10px;font-size:20px">\n'
        '    Thank You For Shopping!\n'
        '  </div>\n'
        '  <div class="center bold" style="font-size:18px;margin-top:8px">\n'
        '    Naye kapdo me jach rahe ho,<br>phir zarur aana :)\n'
        '  </div>\n'
        '\n'
        '  <div class="center" style="margin-top:10px">\n'
        '    <img src="{qr_url}" width="110" height="110" style="image-rendering:pixelated" />\n'
        '  </div>\n'
        '  <div class="center" style="font-size:12px;margin-top:3px">\n'
        '    Accha laga to upar QR scan karein &#8593;<br>Ek review zarur dein\n'
        '  </div>\n'
        '  <div class="double-divider"></div>\n'
        '</div>\n'
        '</body>\n'
        '</html>'
    ).format(
        bill_num=bill_num,
        date_str=date_str,
        salesman_html=salesman_html,
        items_rows=items_rows,
        discount_html=discount_html,
        total_html=rupees_html(total),
        payment_html=payment_html,
        notes_html=notes_html,
        qr_url=QR_IMG_URL,
    )

    return html


# ── Printer ───────────────────────────────────────────────────────

PRINTER_CONTROL_PURGE = 3

JOB_STATUS_PAUSED = 0x00000001
JOB_STATUS_ERROR = 0x00000002
JOB_STATUS_DELETING = 0x00000004
JOB_STATUS_SPOOLING = 0x00000008
JOB_STATUS_PRINTING = 0x00000010
JOB_STATUS_OFFLINE = 0x00000020
JOB_STATUS_PAPEROUT = 0x00000040
JOB_STATUS_PRINTED = 0x00000080
JOB_STATUS_DELETED = 0x00000100
JOB_STATUS_BLOCKED = 0x00000200
JOB_STATUS_USER_INTERVENTION = 0x00000400
JOB_STATUS_RESTART = 0x00000800
JOB_STATUS_COMPLETE = 0x00001000

JOB_STATUS_STUCK = (
    JOB_STATUS_ERROR
    | JOB_STATUS_DELETING
    | JOB_STATUS_OFFLINE
    | JOB_STATUS_PAPEROUT
    | JOB_STATUS_BLOCKED
    | JOB_STATUS_USER_INTERVENTION
    | JOB_STATUS_RESTART
)


def _list_printer_jobs(printer_name):
    hprinter = win32print.OpenPrinter(printer_name)
    try:
        return win32print.EnumJobs(hprinter, 0, 100, 1)
    finally:
        win32print.ClosePrinter(hprinter)


def _clear_spool_files():
    spool_dir = os.path.join(
        os.environ.get('SystemRoot', r'C:\Windows'),
        'System32',
        'spool',
        'PRINTERS'
    )
    removed = 0
    if not os.path.isdir(spool_dir):
        return removed
    for name in os.listdir(spool_dir):
        path = os.path.join(spool_dir, name)
        if os.path.isfile(path):
            try:
                os.remove(path)
                removed += 1
            except Exception:
                pass
    return removed


def restart_spooler_service(hard=False):
    """Restart the Windows Print Spooler service.
    hard=True also deletes stuck spool files from spool/PRINTERS."""
    try:
        subprocess.call(['net', 'stop', 'spooler'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(2)
        if hard:
            removed = _clear_spool_files()
            if removed:
                print('[SPOOLER] Removed {} stuck spool file(s)'.format(removed))
        subprocess.call(['net', 'start', 'spooler'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(2)
        print('[SPOOLER] Service restarted')
    except Exception as e:
        print('[SPOOLER] Service restart failed: {}'.format(e))


def recover_stuck_spooler(printer_name):
    """If queue has stuck jobs, recover automatically."""
    try:
        jobs = _list_printer_jobs(printer_name)
        stuck = [j for j in jobs if (j.get('Status', 0) & JOB_STATUS_STUCK)]
        if not stuck:
            return

        print('[SPOOLER] {} stuck job(s) found. Purging...'.format(len(stuck)))
        hprinter = win32print.OpenPrinter(printer_name)
        try:
            win32print.SetPrinter(hprinter, 0, None, PRINTER_CONTROL_PURGE)
        finally:
            win32print.ClosePrinter(hprinter)

        time.sleep(1)
        remaining = _list_printer_jobs(printer_name)
        if remaining:
            print('[SPOOLER] Queue still not clear. Performing hard reset...')
            restart_spooler_service(hard=True)
    except Exception as e:
        print('[SPOOLER] Recover failed ({}). Performing hard reset...'.format(e))
        restart_spooler_service(hard=True)


def wait_for_queue_idle(printer_name, timeout_sec=45):
    """Wait for queue to become empty and healthy."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        jobs = _list_printer_jobs(printer_name)
        if not jobs:
            return True
        if any(j.get('Status', 0) & JOB_STATUS_STUCK for j in jobs):
            recover_stuck_spooler(printer_name)
            time.sleep(1)
        else:
            time.sleep(1)
    return False


def wait_for_job_completion(printer_name, job_id, timeout_sec=45):
    """Wait for one specific spooler job to complete."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        hprinter = win32print.OpenPrinter(printer_name)
        try:
            try:
                job = win32print.GetJob(hprinter, job_id, 1)
            except Exception:
                # Job not found in queue anymore -> treated as completed.
                return True
        finally:
            win32print.ClosePrinter(hprinter)

        status = job.get('Status', 0)
        if status & JOB_STATUS_STUCK:
            return False
        if status & (JOB_STATUS_PRINTED | JOB_STATUS_COMPLETE | JOB_STATUS_DELETED):
            return True
        time.sleep(1)
    return False


def send_to_printer(printer_name, data):
    """Send raw ESC/POS bytes to a Windows printer. Returns spool job id."""
    hprinter = win32print.OpenPrinter(printer_name)
    try:
        job_id = win32print.StartDocPrinter(hprinter, 1, ("MasterJi Receipt", None, "RAW"))
        win32print.StartPagePrinter(hprinter)
        win32print.WritePrinter(hprinter, data)
        win32print.EndPagePrinter(hprinter)
        win32print.EndDocPrinter(hprinter)
        return job_id
    finally:
        win32print.ClosePrinter(hprinter)


def send_html_to_printer(printer_name, html):
    """Print HTML receipt through Windows printer driver for better quality."""
    with open(RECEIPT_HTML_PATH, 'w', encoding='utf-8') as f:
        f.write(html)

    old_default = None
    try:
        old_default = win32print.GetDefaultPrinter()
    except Exception:
        pass

    try:
        win32print.SetDefaultPrinter(printer_name)
        filepath = os.path.abspath(RECEIPT_HTML_PATH)
        subprocess.call(
            ['rundll32', 'mshtml.dll,PrintHTML', filepath],
            timeout=15
        )
        time.sleep(2)
    except subprocess.TimeoutExpired:
        print('[WARN] HTML print timed out, job may still be in spooler')
    except Exception as e:
        print('[ERROR] HTML print failed: {}'.format(e))
        raise
    finally:
        if old_default:
            try:
                win32print.SetDefaultPrinter(old_default)
            except Exception:
                pass


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
    config_path = os.path.join(SCRIPT_DIR, 'config.ini')
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
    print_mode = config.get('printer', 'mode', fallback='raw')
    poll_interval = config.getint('agent', 'poll_seconds', fallback=5)

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
    print('  Mode: {}'.format(print_mode.upper()))
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
                pass
            else:
                print('[INFO] {} pending job(s) found'.format(len(jobs)))

            for job in jobs:
                queue_id = job.get('queue_id')
                bill_number = job.get('bill_number', '?')

                try:
                    api.update_job_status(queue_id, 'printing')

                    recover_stuck_spooler(printer_name)
                    if not wait_for_queue_idle(printer_name, timeout_sec=45):
                        raise RuntimeError('Spooler queue busy/stuck for too long')

                    if print_mode == 'html':
                        try:
                            html = build_receipt_html(job)
                            send_html_to_printer(printer_name, html)
                            if not wait_for_queue_idle(printer_name, timeout_sec=45):
                                raise RuntimeError('HTML print did not clear from spooler')
                        except Exception:
                            print('[WARN] HTML mode failed, falling back to RAW')
                            receipt_data = build_receipt(job)
                            job_id = send_to_printer(printer_name, receipt_data)
                            if not wait_for_job_completion(printer_name, job_id, timeout_sec=45):
                                recover_stuck_spooler(printer_name)
                                raise RuntimeError('RAW print job stuck in spooler')
                    else:
                        receipt_data = build_receipt(job)
                        job_id = send_to_printer(printer_name, receipt_data)
                        if not wait_for_job_completion(printer_name, job_id, timeout_sec=45):
                            recover_stuck_spooler(printer_name)
                            raise RuntimeError('RAW print job stuck in spooler')

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
