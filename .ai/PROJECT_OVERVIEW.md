# Master Ji Fashion House -- Project Overview

One document that explains the whole application: what it is for, how it works for the people using it, and how it is built. Read this first; read `.ai/APP_RULES.md` before changing anything.

Last updated: 2026-09-26

---

## 1. What this is

A billing and bookkeeping web app for **Master Ji Fashion House**, a budget clothing shop in Shastri Nagar main market, Ghaziabad (UP). It sells everyday women's, kids' and men's wear. Around 250-400 bills a month, 3 salesmen, one owner family.

The shop moved from paper bills and a calculator to this app. Its job is to:

- make a bill quickly on a phone at the counter (MRP + discount, live calculation, print a receipt)
- keep the cash drawer honest (every cash event updates one running balance)
- show the owner what sells, who sells it, how much discount goes out, and monthly profit
- keep an optional customer list (mobile number + name)

It is **not** a POS terminal, ERP or inventory system (inventory is a planned separate project, see section 11). There is **no GST invoicing**: the shop is under the GST composition scheme and issues a *Bill of Supply*.

---

## 2. The people using it

| Role | Who | Device | What they do |
|---|---|---|---|
| **Salesman** | 3 staff, not technical, low English literacy | Basic Android phones | Make bills, print, returns (up to 7 days), look up bills |
| **Admin** | Owner (father) and mother | Phone and shop PC | Everything: reports, cash drawer, expenses, settings, corrections of any age |
| **Print agent** | Python program on the shop PC (Windows 7) | Shop PC + USB thermal printer | Polls the app for print jobs, prints receipts, pulls a daily database backup |

The UI language is balanced **Hinglish**: English for technical and common terms (Cash, UPI, MRP, Discount, Return, Net Profit, Customer name), Hinglish for casual phrases and instructions ("Naya Bill Banao", "Hatao", "Payment mode chuno", "Pichla bill abhi bacha hai").

---

## 3. Screens and what they do

Bottom tabs differ by role. Admin also has **⚙ Settings** in the header.

| Tab | Salesman | Admin | Purpose |
|---|---|---|---|
| **Naya Bill** | ✓ | ✓ | Make a bill. Tapping it while already on it starts a fresh bill (asks first if items exist) |
| **Aaj** | ✓ | -- | Today's figures only: sales, bills, payment split, returns, team performance, categories |
| **Dashboard** | -- | ✓ | Aaj / Hafta / Mahina (month scroller) / Custom analytics with previous-period comparison, trends, CSV export. Custom has a **Quarter (GST)** dropdown (by financial year) for the quarterly turnover, lock and CMP-08 dates |
| **Earnings** | -- | ✓ | Monthly P&L: revenue vs expenses (stock purchase, salaries, utilities, other), expense entry |
| **Hisaab** | -- | ✓ | Cash drawer: balance, petty cash target, today's cash in/out lines, daily sweep, manual correction, cash-out |
| **Bill Book** | ✓ | ✓ | All bills, any date. Search (bill no., mobile, customer name, amount) across all dates, collapsible filters. Print, Return, Edit Bill, Cancel Bill |
| **Settings** | -- | ✓ | Sales Team (names + visible PINs), Categories, Customers (list, history, CSV), Admin users |

### 3.1 Making a bill (the core flow)

**Screen 1 -- Items.** Category pills grouped Ladies / Kids / Gents / Other. Nothing is focused on load. Tap a category → MRP, Discount %, Qty and **+ Add** appear; the live line shows `₹1200 - 20% = ₹960`. The item drops into the list; the input collapses. Each line shows the selling amount large and bold; tapping it edits the **line total**. **Hatao** removes a line. **→ Payment Karo — ₹X**.

**Screen 2 -- Payment.** Bill Preview (paper-bill look, with the item count in black), Sale by (any user can credit the bill to another salesman), admin-only backdate (up to 30 days), optional **Customer mobile** (lookup shows "Pehle aa chuke hain · N bills" and fills the name), **Total** (tap to set a final price; one-tap round-down amounts), payment mode buttons **Cash / UPI / Card** (none pre-selected), optional Split Payment and Note, **✓ Bill Save Karo**, and **Bill cancel karo** (asks first). Cash-only bills round down to the nearest ₹10.

**After saving:** "Bill Ban Gaya!" with **Print Bill** (queues to the shop printer) or **Yahan Print Karo** (browser print).

Rules that shape this flow:

- **Drafts live on the phone** (`localStorage`, per user, 12-hour expiry). Switching tabs, refreshing, Back, the phone killing Chrome, or an expired login never loses a bill. A restored draft shows "Pichla bill abhi bacha hai" with **Naya Bill**.
- **Changing items clears the final price, split and payment mode** -- they were chosen for the old amount. Customer and note stay.
- **Removing the last item resets the whole bill** (except during Edit Bill, which stays in edit mode).
- **Starting over always asks** in an in-app box (phone browsers can skip `window.confirm`).
- Save is safe to retry: each bill version carries a `client_request_id`, so a timeout + retry never makes two bills.

### 3.2 Returns

From Bill Book → **Return**. Pick lines and quantities (remaining returnable qty shown). Refund = what the customer actually paid for that line (share after bill discount and round-off). Refund mode **Cash (default) or UPI -- never Card**. Salesmen: bills up to 7 days old; admin: any age. The return is a separate bill of type `return`, linked to the original, credited to the **original bill's salesman**, and shown as "← MJF-0100 ka return". There is no exchange flow: an exchange is a return plus a new bill.

### 3.3 Corrections: Edit Bill and Cancel Bill

One action, one meaning: **Edit Bill** is the only way to correct a bill; **Cancel Bill** only cancels.

A saved bill is never edited in place.

- **Edit Bill** opens the bill pre-filled in Naya Bill ("Bill MJF-0104 edit kar rahe ho", with **Cancel editing**). On save, one server transaction cancels the old bill and creates the new one (`replaces_bill_id`), keeping the original date and salesman. The drawer moves only by the cash difference. Shown as "MJF-0104 ki jagah" / linked both ways.
- **Cancel Bill** soft-deletes the bill (`deleted_at`) and reverses its cash (unless backdated). Blocked if the bill has an active return ("Pehle iska return bill cancel karo").
- **Admin's Edit Bill is in place** ("…save karne par isi bill mein badlav hoga"): same bill number and date, new items/payments/customer; validated exactly like a new bill (`src/lib/bill-input.js`); drawer moves by the cash difference (never for backdated bills); silent except a hidden `edited_at` / `edited_by` stamp and a `bill_edits` row holding the cash difference (for Hisaab and the audit). The Edit Bill described above (cancel + reissue) is the **salesman's** version.
- Permissions for both: salesman only their own bill within 1 hour; admin any bill **except bills in a GST quarter that's already closed** (locked from the 11th of the month after the quarter ends; those can only be returned). Backdating can't reach a closed quarter either.

### 3.4 Cash drawer (Hisaab)

`app_state.cash_drawer` is one persistent running balance, updated inside the same transaction as every cash event: cash sale (+), cash refund (−), cancelling a cash bill (−), cash-out (−), Edit Bill (± difference), manual correction (set). **Backdated bills never touch it.** Petty cash target = the float left in the drawer after the daily **sweep** (cash-out of type `sweep`). Hisaab shows today's lines, including separate Refund (cash) and Cancelled bill (cash) lines when they exist.

### 3.5 Reports

- **Returns are not bills**: bill counts and Avg Bill use sale bills only (avg = gross sales / sale count). Net revenue = sales − returns.
- **Dashboard and Earnings agree** on bills and net revenue for the same period.
- Category breakdown allocates the bill-level discount to lines, so categories add up to net revenue.
- Salesmen see sales figures for **today only** (server-enforced); Bill Book records are any date for everyone.
- Money format everywhere: `₹1,23,456`, negatives as `-₹999`.

### 3.6 Customers

Optional on every bill. A **phone number = a household** (family members share one): `customers` holds one row per normalised 10-digit mobile (starts 6-9; `+91`, leading 0, spaces and dashes stripped) with the latest name; each bill also stores the name as typed. Returns and Edit Bill inherit the customer. Admin **Settings → Customers**: searchable list with bills, spend (net of returns), last visit; tap for their bills; CSV export. Internal use only -- no automated messages.

---

## 4. Receipt format

Printed by the shop PC agent on an 80 mm thermal printer (TVS RP 3200 Star, ESC/POS, 42 characters per line). The browser fallback (`src/lib/print-receipt.js`) prints the same layout as HTML. **Keep the two identical.** Sample sale:

```
==========================================
             BILL OF SUPPLY
   Composition taxable person, not
   eligible to collect tax on supplies
==========================================
                MASTER JI                        (double size)
              FASHION HOUSE                      (double size)
        C Block, Main Market Road
        Shastri Nagar, Ghaziabad
      Ph: 9540664066 / 0120-4245977
      GSTIN: 09AGHPG4211E1ZV
==========================================
Bill: MJF-0231        26 Sep 2026  5:42 PM
Salesman: Salesman 1
Customer: Pooja                                  (only if entered)
------------------------------------------
Item                       Qty          Rs
------------------------------------------
Kurti                        2       2,598
Palazzo/Pant                 1         899
------------------------------------------
MRP Total                         Rs 3,497
Discount                           -Rs 787       (only if any)
==========================================
TOTAL        Rs 2,710                            (double size)
==========================================
CASH                              Rs 1,500       (one line per payment, always)
UPI                               Rs 1,210

Note: Alteration Monday                          (only if any)
------------------------------------------
    Exchange / Return sirf 7 din mein
------------------------------------------

                 For MASTER JI FASHION HOUSE
                        Authorised Signatory
------------------------------------------
     Thank you for shopping with us!
   We look forward to seeing you again.

            [QR: Google review link]
    Accha laga to upar QR scan karein
          Ek review zarur dein
==========================================
```

Rules:
- **Item Rs = MRP × qty** (no Rate column). Items saved without an MRP (old bills) show their line amount. **MRP Total** = sum of the Rs column, so the printed column always adds up.
- **Discount** = MRP Total − TOTAL: item discounts, final price and cash round-off together (no separate Round Off line; the app stores them together).
- **Return bills** print `RETURN — against MJF-0100` under the bill line, the refund amount per line, no MRP Total/Discount, and `REFUND Rs X` instead of TOTAL.
- Bill number format stays `MJF-XXXX` (one running series; legally fine).
- Composition-scheme Bill of Supply: the heading and declaration print at the top of every bill. The GSTIN (`SHOP_GSTIN`, 09AGHPG4211E1ZV) is set in **both** `print-agent/agent.py` and `src/lib/print-receipt.js`; change both together.
- The review QR points to `https://g.page/r/Cdj1aJR-po6TEBI/review`; the browser receipt uses `public/review-qr.png`.
- All bill text is escaped (HTML) or stripped of control characters (ESC/POS).

---

## 5. Architecture

```
 Phones / shop PC browser                     Railway (one service)                  Shop PC (Windows 7)
 ┌───────────────────────┐   HTTPS + JWT    ┌──────────────────────────────┐        ┌──────────────────────┐
 │ Next.js React UI      │ ───────────────▶ │ Next.js 14 App Router        │ ◀───── │ print-agent/agent.py │
 │ (PWA, Hinglish)       │                  │  /api/* route handlers       │  poll  │  every 5 s, agent    │
 │ draft in localStorage │                  │  better-sqlite3 (sync, txns) │  token │  token; prints via   │
 └───────────────────────┘                  │  SQLite file on volume       │        │  USB; daily backup   │
                                            │  DATA_DIR (/data)            │        │  pull (keeps 30)     │
                                            └──────────────────────────────┘        └──────────────────────┘
```

- **Stack:** Next.js 14 (App Router), React 18, Tailwind CSS, plain JavaScript (no TypeScript), `better-sqlite3`, `jsonwebtoken`, `bcryptjs`. Node 22 LTS. No other runtime dependencies.
- **Database:** one SQLite file. `data/masterji_dev.db` in dev (`DB_MODE=dev`), `masterji.db` in prod on the Railway volume. WAL mode. All writes that belong together run in one synchronous `db.transaction()`.
- **Time:** IST timestamps stored as TEXT (`datetime('now','+5 hours','+30 minutes')`); no timezone library.
- **Auth:** salesman = pick name + 4-digit PIN; admin = username + password (bcrypt). JWT (HS256, 24 h) in `localStorage`. The server re-reads the user on every request, so deactivating a user blocks them immediately. A 401 sends the app to the login screen with the draft kept.
- **Print agent auth:** `X-Print-Agent-Token` header = `PRINT_AGENT_TOKEN` (timing-safe compare).

### 5.1 Code map

```
src/
  app/
    layout.js, page.js, error.js, global-error.js, globals.css
    api/                       one folder per resource, all `dynamic = 'force-dynamic'`
      auth/{login,me,salesmen}   login with rate limiting; salesmen list is public (login screen + health check)
      bills/ bills/[id] bills/[id]/return
      cash-drawer/ cash-out/ hisaab/
      categories/ categories/[id]
      customers/ customers/lookup
      dashboard/ earnings/ export/
      expenses/ expenses/[id] expenses/copy expenses/labels
      print-queue/ print-queue/[id] print-agent/files/[name]
      backup/  users/ users/[id]
  components/
    AppShell.js        tabs, header, keeps NewBill mounted, Naya Bill tab = new bill
    NewBill.js         billing flow (items → payment), drafts, Edit Bill, customer, final price
    SalesHistory.js    Bill Book: search, filters, returns panel, print, Edit Bill, cancel
    TodaySummary.js    salesman "Aaj"
    Dashboard.js  Earnings.js  DayClose.js (Hisaab)  Settings.js  Customers.js
    BillPreview.js CashOutForm.js CategoryBreakdown.js DeltaBadge.js LoadError.js LoginPage.js
  context/auth.js      AuthProvider, token + cached user, 401 handling
  lib/
    db/index.js        THE schema: SCHEMA_SQL, MIGRATIONS array, auto-seed, helpers
    db/seed.js         resets a LOCAL database only
    api-client.js      fetch wrapper: 20 s timeout, request ids, Hinglish errors, 401 event
    auth.js            JWT + requireAuth / requireAdmin / requireAdminOrAgent
    login-limits.js    login rate limiting
    bill-draft.js      localStorage drafts
    date-utils.js      IST dates, month helpers
    phone.js           mobile normalisation/validation
    limits.js          MAX_MRP (₹25,000/piece), MAX_QTY_PER_LINE (100), SALESMAN_CHANGE_MINUTES (60)
    bill-input.js      shared validation for new bills and admin's in-place edit
    backup.js          bucket backups: snapshot, upload, retention, status
    print-receipt.js   browser receipt
    ui-utils.js bill-data.js
tests/                 node:test integration tests against a real dev server (npm test)
print-agent/           agent.py, update.py, start.bat, install.bat, config.example.ini, README.txt
public/                manifest.json, icon-192/512.png (rendered from src/app/icon.svg), review-qr.png
railway.json           build/start commands, health check /api/auth/salesmen
```

### 5.2 Data model

| Table | Purpose / key columns |
|---|---|
| `users` | `role` admin/salesman, `username` + `password_hash` (admin), `pin` (salesman, plain, shown to admin by design), `active` |
| `categories` | `name`, `group_name` (women/kids/men/other), `display_order`, `active` |
| `bills` | `bill_number` `MJF-XXXX`, `type` sale/return, `original_bill_id` (returns), `subtotal`, `mrp_total`, `discount_amount` (authoritative), `discount_percent` (derived), `total`, `payment_mode` cash/upi/card/mixed, `salesman_id`, `notes`, `deleted_at` (soft delete), `is_backdated`, `client_request_id` (unique), `replaces_bill_id`, `customer_id`, `customer_name`, `created_at` |
| `bill_items` | `bill_id`, `category_id`, `mrp`, `quantity`, `amount` (line total), `orig_bill_item_id` (return lines), `cost_price` (unused, reserved) |
| `bill_payments` | `bill_id`, `mode` cash/upi/card (never mixed), `amount` |
| `cash_out` | `amount`, `reason` expense/supplier/owner/other/sweep/manual, `note`, `recorded_by`, `client_request_id` |
| `app_state` | single row: `cash_drawer`, `petty_cash_target`, `schema_version` |
| `print_queue` | `bill_id`, `status` pending/printing/printed/failed, `requested_by`, `printed_at` |
| `expenses` | `expense_month` (YYYY-MM), `expense_date`, `category` stock_purchase/salaries/shop_utilities/other, `amount`, `label`, `note`, `recorded_by` |
| `customers` | `phone` (unique, 10 digits), `name`, `first_seen_at`, `last_seen_at` |
| `login_attempts` | failed logins per account + IP (lockouts) |

Migrations: numbered functions in `MIGRATIONS` (`src/lib/db/index.js`), tracked by `app_state.schema_version`, each in its own transaction. Current version **14**. Notable: v8 money integrity (backdated flag, request ids, Edit Bill link, return line links), v9 login attempts, v10 drop the old UPI QR table, v11 customers , v12 re-credit old returns to the original salesman , v13 admin in-place edit stamp (`bills.edited_at/edited_by`, `bill_edits`), v14 bucket backup status (`app_state.last_backup_*`).

### 5.3 Security

- Login lockout: 5 wrong tries per (account, IP), 30 per IP, 20 per account, in 15 minutes; constant-time response.
- Security headers + CSP in `next.config.js` (no third-party scripts or images), HSTS, no framing.
- Server-side permissions for every admin-only route; salesmen restricted to today's figures.
- Input caps: ≤100 items, ≤3 payments, notes ≤500 chars, MRP ≤ ₹25,000/piece, qty ≤ 100/line; malformed JSON → 400.
- CSV export escapes formula injection; receipts escape HTML.
- Production refuses to start on an empty database (a missing volume) unless `ADMIN_INITIAL_PASSWORD` is set for a genuinely new install. No default credentials in prod.

### 5.4 Environment and deployment

| Variable | Where | Meaning |
|---|---|---|
| `JWT_SECRET` | Railway + `.env.local` | JWT signing secret (required) |
| `DATA_DIR` | Railway | Path of the mounted volume holding the SQLite file |
| `PRINT_AGENT_TOKEN` | Railway + shop PC `config.ini` | Shared secret for the print agent (rotate both together) |
| `ADMIN_INITIAL_PASSWORD` | Railway, first start only | Creates the first admin on a brand-new install |
| `BUCKET_ENDPOINT`, `BUCKET_NAME`, `BUCKET_REGION`, `BUCKET_ACCESS_KEY`, `BUCKET_SECRET_KEY` | Railway (from the attached bucket) | Automatic bucket backups; optional `BUCKET_FORCE_PATH_STYLE=true` if the bucket needs path-style URLs |
| `DB_MODE=dev` | local (`npm run dev`) | Use `masterji_dev.db`, auto-seed test users |
| `NEXT_DIST_DIR` | local/tests | Separate build folder (tests use `.next-test`) |

Railway builds with `npm run build`, starts with `npm start`, health check `/api/auth/salesmen`. Deploys come from `main`.

**Backups** (three copies, all consistent SQLite snapshots):
1. **Railway bucket, automatic** (`src/lib/backup.js`, started by `src/instrumentation.js` → `src/backup-scheduler.js`): daily after 11:30 pm IST, gzipped, as `backups/daily/masterji-YYYY-MM-DD.db.gz` (30 days), `backups/monthly/masterji-YYYY-MM.db.gz` (24 months) and `backups/quarterly/masterji-FY26-27-Q2.db.gz` (forever, taken once the quarter locks). Off without the `BUCKET_*` variables or with `DB_MODE=dev`. Status in `app_state.last_backup_*`; `GET /api/backup/status`, `POST /api/backup/run` (admin).
2. **Shop PC**, pulled daily by the print agent from `GET /api/backup`, 30 kept.
3. **Download backup** (Settings → Admin → Backup) any time, from `GET /api/backup`.

**Restoring** (only if the live database is lost or damaged): download the wanted `.db.gz` from the bucket (e.g. `aws s3 presign` in the Railway console) or take a shop-PC copy; `gunzip` it; stop the app in Railway; replace `$DATA_DIR/masterji.db` with it (and delete any `masterji.db-wal` / `-shm`) via `scp` or the console; start the app. Bills made after that backup are lost, so use the newest good copy. Run `npm run audit` on it first.

**Print agent updates:** `update.bat` → `update.py` downloads `agent.py`, `update.py`, `start.bat` from `/api/print-agent/files/*` using the agent token (works with a private repo). `start.bat` restarts the agent if it exits.

---

## 6. Commands

```bash
npm install          # Node 22
npm run dev          # dev server on dev DB (add -- -H 0.0.0.0 to reach it from phones on the same Wi-Fi)
npm test             # integration tests on a throwaway DB (incl. the money integrity stress test)
npm run audit -- <db-file>    # money audit of a DB copy + turnover by month and GST quarter
npm run seed:dev -- --force   # reset the local dev DB
npm run build && npm start    # production build locally
```

---

## 7. Glossary

| Term | Meaning |
|---|---|
| Naya Bill | New bill |
| Hatao | Remove |
| Edit Bill | Correct a saved bill (cancel + reissue; the saved bill itself is never changed) |
| Cancel Bill | Void a saved bill (soft delete) |
| Hisaab | Cash drawer / day close |
| Aaj / Hafta / Mahina | Today / week / month |
| Backdated | Bill entered for an earlier date (admin only); never touches the drawer |
| Sweep | Taking the day's cash out of the drawer, leaving petty cash |
| Bill of Supply | The composition-scheme bill format (no tax charged) |

---

## 8. Other documents

| File | What it is |
|---|---|
| `.ai/APP_RULES.md` | **Developer guidelines -- the rules to follow when changing anything** |
| `.ai/DECISIONS.md` | **Decision log -- every owner decision and why (tax, money, access, UI, ops)** |
| `README.md` | Setup, feature list, API table, design decisions |
| `CHANGELIST.md` | Change history with manual test steps |
| `DEFERRED_FEATURES.md` | Analysed ideas deliberately not built |
| `QA_TEST_REPORT.md` | Historical QA pass (April 2026), before Project 1 |
| `print-agent/README.txt` | Shop PC setup for the print agent |

---

## 9. History in brief

- MVP (early 2026): billing, dashboard, Hisaab, Bill Book, print agent, Earnings.
- **Project 1 -- Hardening + enhancements (Sept 2026)**: test suite, backups, money-correctness fixes (returns, cancels, split payments, drawer), security (rate limiting, escaping, CSP, permissions), UPI QR removal, never-lose-a-bill drafts, Final Price redesign, Edit Bill, customers, real Bill Book search, report fixes, Bill of Supply wording. Built on branch `feature/project1-hardening`; merged to `main` only at the final build.

---

## 10. Open items

- Shop-PC visit: install the new `update.py` once, run `update.bat`, rotate `PRINT_AGENT_TOKEN` in Railway and `config.ini` together.
- Make the GitHub repo private (Railway keeps deploying; printing is unaffected).
- Before merging to `main`: back up the prod DB, test migrations on a copy of it, confirm Node 22 on Railway.

---

## 11. Roadmap: Project 2 -- inventory, barcode, tag printing (parked)

Planned as a separate project after Project 1. Key decisions already made (they need the same "only what's necessary" review before building):

- **Design × size catalogue**: `products` (category, colour, MRP, optional cost, lot, supplier) → `product_variants` (size, barcode, qty). Stock changes go through an append-only `stock_moves` ledger.
- **New arrivals + opportunistic backfill** -- no shop-wide stock-take. Billing by category (no scan) stays a first-class path forever; stock reports say "Sirf tag wala maal".
- **Hardware already owned**: USB HID barcode scanner (shop PC), TSC TTP-244 Pro label printer (TSPL), 50×25 mm labels. Phone camera scanning via `BarcodeDetector` where available.
- **Code format**: `MJ` + 2-letter category code + 4-digit per-category sequence + size, e.g. `MJKU0413L`, Code 128. Never encode mutable data (price) in the barcode.
- **Coded floor price** on the tag using the first letter of Hindi number words: `Z E D T C P X S A N` for 0-9; floor = cost × 1.2 (20 % minimum margin, admin setting), rounded to ₹10.
- **Size sets**: Alpha, Chest, Waist, Kids Age, Kids Chest, Free, Innerwear (alpha/numeric), Bra; chosen per product, category holds a default.
- **Suppliers** with city; lots link to the `stock_purchase` expense.
- Intake on phone and PC ("add to list, then print all tags for the lot"); tags print from the shop PC agent.
- Scan on Naya Bill = add to bill with MRP pre-filled (discount still typed); never block a sale on zero stock.
- Migrations continue from **v15**.
