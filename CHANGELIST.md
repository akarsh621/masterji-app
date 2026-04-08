# Changelist -- Master Ji Fashion House App

Last updated: 2026-04-08

This document lists every change made with step-by-step test instructions for QA handoff.

---

## 1. Technical Debt Cleanup

### What changed
- Removed unused `recharts` dependency from `package.json`
- Deleted `app/backend/` and `app/frontend/` folders (old prototype, not in use)
- Created `.gitignore` (excludes `node_modules/`, `.next/`, `data/`, `.env.local`)
- Removed hardcoded JWT secret fallback in `src/lib/auth.js` -- app now requires `JWT_SECRET` in `.env.local`

### How to test
1. Run `npm run dev` -- app should start without errors
2. Verify `backend/` and `frontend/` folders are gone
3. Delete `.env.local` temporarily, run `npm run dev` -- should see error: "JWT_SECRET environment variable is not set"
4. Restore `.env.local`, restart -- should work normally

---

## 2. Clean Schema with Migration Framework

### What changed
- Schema includes all 9 tables: `users`, `categories`, `bills`, `bill_items`, `bill_payments`, `cash_out`, `app_state`, `print_queue`, `expenses`
- `app_state` has `schema_version` column tracking applied migrations
- `MIGRATIONS` array in `db/index.js` runs numbered migrations on startup (v1-v4)
- Auto-seed on empty database creates default admin, salesmen, and categories

### How to test
1. Delete `data/masterji_dev.db` if it exists
2. Run `npm run dev` -- auto-seeds, should start without errors, console shows migration logs
3. Verify all 9 tables exist

---

## 3. Split/Mixed Payment Support

### What changed
- `bill_payments` table stores per-payment-mode amounts
- Bills API accepts `payments: [{ mode, amount }]` array
- `bills.payment_mode` = `'mixed'` when multiple modes used, single mode otherwise
- Dashboard/TodaySummary aggregate cash/UPI/card totals from `bill_payments`
- CSV export includes "Payment Split" column
- SalesHistory filter dropdown includes "Mixed" option

### How to test

**Single payment:**
1. Login as salesman (PIN: 1111), create a bill with any items
2. UPI is selected by default -- save bill
3. Check Bill Book -- bill shows UPI
4. Check Dashboard (admin login: admin/admin123) -- UPI total includes this amount

**Split payment:**
1. Create a bill totaling e.g. Rs 1000
2. Tap "Split Payment?" -- it turns blue, second mode selector appears
3. Select Cash as second mode, enter Rs 400 in split amount
4. Verify breakdown: "UPI: Rs 600 + Cash: Rs 400"
5. Save -- check Bill Book (expanded bill shows "Payment Split")
6. Check Dashboard -- UPI +Rs 600, Cash +Rs 400
7. Filter Bill Book by "Mixed" -- shows only split bills

---

## 4. Returns/Exchanges

### What changed
- Bills have `type` (`'sale'`/`'return'`) and `original_bill_id` linking returns to original sale
- API: `POST /api/bills/:id/return` creates a return bill
- Dashboard shows net revenue (gross - returns), return count
- Return bills styled with red left border + "RETURN" tag

### How to test

**Process a return:**
1. Login as admin, go to Bill Book, expand a sale bill
2. Tap "Return / Exchange" (left side, orange bordered button)
3. Use +/- to select return quantities, select refund mode
4. Tap "Return Confirm"
5. New bill appears with red "RETURN" tag and negative amount
6. Dashboard net revenue decreased by return amount

---

## 5. Cash Out Log (with Petty Cash Labels)

### What changed
- `cash_out` table tracks cash leaving the drawer with reason codes: `expense`, `supplier`, `owner`, `other`, `sweep`, `manual`
- Display labels in Hinglish: "Roz ka Kharcha" (default), "Supplier", "Cash / Sale Withdrawal", "Other", "Daily Sweep", "Cash Out"
- Shared `REASON_LABELS` in `ui-utils.js` for consistent display
- Hisaab tab integrates cash-out into drawer reconciliation

### How to test
1. Login as admin, go to Hisaab tab
2. Tap "Cash Out" button, select "Roz ka Kharcha" (should be default)
3. Enter Rs 200, note "Chai for team", save
4. Drawer decreases by Rs 200, entry appears in cash flow
5. Record "Supplier" Rs 500 and "Cash / Sale Withdrawal" Rs 1000
6. Verify all categories appear with correct Hinglish labels

---

## 6. Bill Correction (Void + Re-create)

### What changed
- Salesman can cancel own bill within 15 minutes ("Galat hai? Delete karo" button)
- Admin can void any bill anytime ("Galat hai? Delete karo" styled consistently)
- After void, admin gets "Iske badle naya bill banao?" prompt -- opens NewBill pre-filled

### How to test

**Salesman self-void:**
1. Login as salesman, create a bill
2. Go to Bill Book -- see "Galat hai? Delete karo" on the right side
3. Tap it -- bill voided
4. After 15 minutes, button disappears on older bills

**Admin void + recreate:**
1. Login as admin, Bill Book, expand bill, click "Galat hai? Delete karo"
2. Confirm --> "Iske badle naya bill banao?" --> OK
3. NewBill tab opens with items pre-filled, modify and save

---

## 7. Custom Date Range in Dashboard

### What changed
- "Custom" pill next to Aaj/Hafta/Mahina, shows from/to date pickers

### How to test
1. Admin Dashboard, tap "Custom", set date range, tap "Apply"
2. Data shows only that range; Export CSV respects range

---

## 8. Period-over-Period Comparison

### What changed
- Dashboard API returns `previous_summary` (today vs yesterday, week vs prev week, etc.)
- Green/red delta badges (shared `DeltaBadge` component) on revenue, bill count, avg bill value

### How to test
1. Create bills today, go to Dashboard
2. If yesterday had different totals, delta badges appear (e.g. "+25%" in green)
3. Switch to Hafta/Mahina -- comparison against previous week/month

---

## 9. Persistent Cash Drawer with Petty Cash & Daily Sweep

### What changed
- `app_state` table with persistent `cash_drawer` and `petty_cash_target` values
- Every cash event atomically updates drawer in same DB transaction
- **Hero card** on Hisaab shows: Cash Drawer total (main), Sale Cash and Petty Cash in subscript
- **"Correct Karo"** button: opens two-row editor for both drawer amount and petty cash target
- **"Sweep Karo"** button (admin): pre-calculates `current_drawer - petty_cash_target`, editable, records as `sweep` type cash-out
- API: `GET /api/cash-drawer`, `PUT /api/cash-drawer` (manual correct), `PATCH /api/cash-drawer` (petty target)

### How to test
1. Fresh DB --> Hisaab shows ₹0 drawer
2. Create cash bill Rs 500 --> drawer ₹500
3. Split bill Rs 600 cash + Rs 200 UPI --> drawer ₹1,100
4. Cash out Rs 100 --> drawer ₹1,000
5. Void the Rs 500 bill --> drawer ₹500
6. Admin "Correct Karo" -- edit both drawer (₹5,000) and petty cash (₹1,000) -- save
7. Tap "Sweep Karo" -- pre-filled with ₹4,000 (5000 - 1000) -- confirm
8. Drawer drops to ₹1,000 (petty cash left), sweep appears in cash flow

---

## 10. Dev vs Prod Database

### What changed
- `DB_MODE=dev` uses `masterji_dev.db`, prod uses `masterji.db`
- Amber "DEV MODE" banner in dev mode
- `npm run dev` = dev DB, `npm run prod` = prod DB
- Migrations auto-run on both DBs independently

### How to test
1. `npm run dev` --> amber "DEV MODE" banner, uses `masterji_dev.db`
2. `npm run prod` --> no banner, uses `masterji.db`, dev data not visible

---

## 11. Salesman All-Store Visibility

### What changed
- **Aaj tab** and **Bill Book tab** for salesmen now show ALL bills across the store, not just their own
- Enables cross-verification between salesmen and acts as a shared view for the salesman acting as day manager

### How to test
1. Login as Salesman 1, create a bill
2. Login as Salesman 2, go to Aaj tab -- should see Salesman 1's bill in totals
3. Go to Bill Book -- should see Salesman 1's bill in the list

---

## 12. Billing UX Overhaul -- MRP + Discount % + Category-First Flow

### What changed
- **Default state**: Page loads with ONLY category pills visible. No input fields, no auto-select, no keyboard opening.
- **Category tap**: Highlights category, slides in input section (MRP, Discount %, Qty, Add), focuses MRP input.
- **After adding item**: Input section collapses, category deselects. Salesman sees categories + bill.
- **MRP + Discount % model**: Salesman enters MRP (tag price) + Discount %. Live calculation: `₹1200 - 20% = ₹960`.
- **Item list**: Category name (bold), quantity badge, MRP-discount calculation, editable selling price on right.
- **Tappable editable price**: Final selling price in item list is tappable -- salesman can override and discount_percent recalculates.
- **"Hatao" button**: Small delete button per item with safe spacing from price.
- **Summary**: Total items count + total amount.
- **UI enlargement**: Category pills, item rows, calculation text, payment totals all enlarged for better phone readability.
- **Schema**: `bill_items.mrp` column stores MRP per item, `bills.mrp_total` stores sum of all MRPs.

### How to test

**Category-first flow:**
1. Login as salesman -- only category pills visible, NO input fields, NO keyboard
2. Tap "Kurti" --> input section appears (MRP, Discount %, Qty), MRP focused
3. Enter MRP: 1200, Discount: 20 --> see live "₹1200 - 20% = ₹960"
4. Tap "+ Add" --> input collapses, category deselects
5. Item shows: "Kurti x1" with "₹1200 - 20% = ₹960" and bold ₹960

**Editable price:**
1. After adding an item, tap the ₹960 price on the right
2. Change to ₹900, confirm -- discount recalculates to match

**Rapid adding:**
1. Tap "Kurti" -> add -> Tap "Top" -> add -> Tap "Pant" -> add
2. Should NEVER accidentally add under wrong category

---

## 13. Payment Screen UX

### What changed
- **UPI as default payment mode** (not cash) -- reflects real-world usage patterns
- **"Final Price Set Karo?"** button for bill-level discount (Final ₹ or % Off tabs)
- **"Lagao" (Apply) button** dismisses keyboard and shows result
- **Discount display**: Orange box shows "₹1120 se ₹120 off" and "Final: ₹1000" in green
- **Cash auto-rounding**: For cash-only payments, total is floored to nearest 10. Subtle "₹X round off" shown.
- **"← Items Edit Karo"**: Filled blue button (not ghost outline) so salesmen notice it
- **Bill preview card**: Shows each item with MRP and discount calculation

### How to test

**Default UPI:**
1. Add items, go to payment screen
2. UPI should be selected by default (not cash)

**Cash auto-rounding:**
1. Add items totaling ₹1,473
2. Select Cash as payment mode
3. Total should show ₹1,470 with subtle "₹3 round off" text
4. Switch to UPI -- total shows ₹1,473 (no rounding)

**Final price discount:**
1. Tap "Final Price Set Karo?"
2. Enter 1400, tap "Lagao" --> keyboard dismisses, shows orange "₹70 off"
3. Tap "Hatao" --> discount removed

---

## 14. On-Bill Salesman Selector

### What changed
- Both admin and salesman login get a minimal "Sale by: [Name]" selector on the payment screen
- Tapping the edit icon expands pill options showing all active salesmen
- Selecting a different salesman assigns the bill to them on save
- Non-intrusive: collapsed by default, shows current user's name

### How to test
1. Login as Salesman 1, go to payment screen
2. See "Sale by: Salesman 1" with edit icon
3. Tap edit --> pill options appear (all salesmen)
4. Select Salesman 2, save bill
5. Bill Book shows the bill under Salesman 2
6. Same flow works for admin login

---

## 15. Print Queue & Receipt Printing

### What changed
- `print_queue` table stores print jobs with status tracking
- "Print Bill" button on bill completion screen and Bill Book queues a print job
- Print agent (Python) polls for pending jobs and sends to local printer
- Fallback "Yahan Print Karo" link for direct browser-based receipt printing
- Receipt includes shop branding, itemized bill, QR code for Google review

### How to test
1. Create a bill, save it
2. On the "Bill Done" screen, tap "Print Bill"
3. Confirmation: "Print queue mein bhej diya!" (or similar)
4. In Bill Book, expand any bill -- "Print Bill" button available
5. "Yahan Print Karo" opens browser print dialog with formatted receipt

---

## 16. Dashboard Trends & Category Breakdown

### What changed
- **Daily trend** chart in Hafta view (Mon-today) showing revenue per day
- **Mahina view** has toggle: "Weekly Trend" (default) and "Daily Trend" (horizontally scrollable)
- Fallback: if weekly trend has < 2 data points, auto-falls back to daily trend
- **Category breakdown** grouped by Ladies/Gents/Kids/Other first, expandable to individual categories
- Shared `CategoryBreakdown` component reused across Dashboard and TodaySummary
- **Refresh/Export button feedback**: Shows "Refreshing..."/"Exporting..." state while loading

### How to test

**Trends:**
1. Login as admin, go to Dashboard
2. Hafta tab: should show daily trend chart (bars for each day Mon-today)
3. Mahina tab: should show "Weekly Trend" by default with toggle to "Daily Trend"
4. If < 2 weeks of data, should auto-show daily trend

**Category breakdown:**
1. Dashboard shows Ladies/Gents/Kids/Other groups with totals
2. Tap a group to expand individual categories within it
3. Same breakdown visible on salesman's Aaj tab

**Button feedback:**
1. Tap Refresh button -- should show "Refreshing..." briefly
2. Tap Export button -- should show "Exporting..." briefly

---

## 17. Hisaab Refresh Button Feedback

### What changed
- Hisaab tab's refresh button now shows "Refreshing..." state (matches Dashboard pattern)
- Shared component behavior across all refresh buttons

### How to test
1. Go to Hisaab tab, tap refresh
2. Button should show loading state briefly, then data refreshes

---

## 18. True Discount Tracking (MRP Total on Bills)

### What changed
- `bills.mrp_total` column stores sum of all item MRPs
- True total discount = `mrp_total - total` (captures BOTH per-item haggling AND bill-level extra discount AND cash round-off)
- Dashboard shows accurate "Total Discount" with percentage off MRP
- Bill Book collapsed row shows discount amount in orange
- Bill Book expanded view shows per-item MRP breakdown

### How to test
1. Create bill: Kurti MRP ₹1000 at 20% off = ₹800. No extra discount. Save.
2. Aaj tab: should show "-₹200" under discount, NOT ₹0
3. Create bill with extra bill-level discount too -- totals should be cumulative
4. Dashboard "Total Discount" reflects all discount sources
5. No NaN% anywhere

---

## 19. Bill Book Layout

### What changed
- "Return / Exchange" button on left with orange border
- "Galat hai? Delete karo" button on right (consistent for both admin and salesman)
- Buttons have clear separation, no overlap
- Print and Exchange buttons aligned left, Delete aligned right

### How to test
1. Login as salesman, expand recent bill in Bill Book
2. Bottom row: "Return / Exchange" on LEFT, "Galat hai? Delete karo" on RIGHT
3. No button overlap
4. Login as admin, same layout

---

## 20. CSV Export (Compact Items Column)

### What changed
- Single "Bills" CSV with compact `Items Detail` column (e.g. "Boys Pant x1, Girls Top x2, Kurti x2")
- No separate Items CSV needed

### How to test
1. Admin Dashboard, select a date range, tap Export
2. Download CSV, verify each row has an "Items Detail" column with readable item list
3. Total column should be summable without double-counting

---

## 21. Expense Tracking & Monthly P&L (Earnings Tab)

### What changed
- New admin-only **Earnings** tab in bottom navigation (Settings moved to header gear icon)
- **`expenses` table** with 4 categories: Stock Purchase, Salaries, Shop & Utilities, Other
- **Expense CRUD**: Add, edit, delete expenses per month with label autocomplete
- **Monthly P&L card**: Revenue vs Total Expenses = Net Profit, with profit margin %, expense ratio, stock % indicator
- **Key numbers grid**: Avg Bill, Total Bills, Revenue/Day, Items/Bill
- **Expense list**: Collapsible by category, tap to edit, delete with confirmation
- **Month navigation**: Left/right arrows, defaults to current month, no future months
- **Previous month comparison**: Delta showing profit change vs last month
- **"Pichle Mahine Se Copy" button**: Copies all expenses from previous month into current month (shown only when current month is empty and previous has data)
- **Info tooltips**: Hinglish explanations on every metric for the owner
- New API endpoints: `GET/POST /api/expenses`, `PATCH/DELETE /api/expenses/:id`, `GET /api/expenses/labels`, `POST /api/expenses/copy`, `GET /api/earnings`

### Files touched
- `src/lib/db/schema.sql` (added `expenses` table + indexes)
- `src/lib/db/index.js` (migration v4, inline schema)
- `src/app/api/expenses/route.js` (NEW)
- `src/app/api/expenses/[id]/route.js` (NEW)
- `src/app/api/expenses/labels/route.js` (NEW)
- `src/app/api/expenses/copy/route.js` (NEW)
- `src/app/api/earnings/route.js` (NEW)
- `src/lib/api-client.js` (7 new methods)
- `src/components/Earnings.js` (NEW)
- `src/components/AppShell.js` (new tab + Settings to header)

### How to test

**Navigation:**
1. Login as admin -- bottom nav: Naya Bill, Dashboard, **Earnings**, Hisaab, Bill Book
2. Settings is now a gear icon in the top-right header (next to Logout)
3. Tap gear icon -- Settings screen loads
4. Login as salesman -- NO Earnings tab visible (admin only)

**Month navigation:**
1. Go to Earnings tab -- shows current month (e.g. "April 2026")
2. Tap left arrow -- goes to March 2026
3. Right arrow goes forward; disabled when on current month

**P&L card (with no expenses):**
1. On a month with bills but no expenses entered
2. Revenue shows correctly (from bills data)
3. Expenses section shows "Koi expenses nahi dale — neeche se add karein ↓"
4. Net Profit = Revenue (100% margin, green)

**Adding expenses:**
1. Tap "+ Add" button in Expense List section
2. Form appears with category pills: Stock Purchase (default), Salaries, Shop & Utility, Other
3. Select "Stock Purchase" -- shows: Supplier Name*, Amount*, Date, Note fields
4. Enter: Supplier "Ramesh Textiles", Amount 80000, Date (pick a date), Note "Kurti lot"
5. Tap "Add Expense" -- form closes, expense appears under Stock Purchase category
6. P&L card updates: Revenue - ₹80,000 = lower net profit

**Adding salary:**
1. Tap "+ Add", select "Salaries"
2. Shows: Person Name*, Amount*, Note fields (no date field)
3. Enter "Rohit", ₹15000, save
4. Appears under Salaries category

**Adding shop utilities:**
1. Tap "+ Add", select "Shop & Utility"
2. Shows: Amount*, Note fields only (no label, no date)
3. Enter ₹5000, note "Bijli 3K bags 2K", save

**Editing an expense:**
1. In the expense list, tap on any entry (not the ✕ button)
2. Edit form opens pre-filled
3. Change amount, save -- list and P&L update

**Deleting an expense:**
1. Tap ✕ button on an entry
2. Confirmation: "Delete karna hai? ₹80,000 — Ramesh Textiles"
3. Confirm -- entry removed, totals update

**Autocomplete (labels):**
1. Add a stock purchase for "Ramesh Textiles"
2. Add another stock purchase -- below the Supplier Name input, see "Ramesh Textiles" as a suggestion pill
3. Tap it -- name auto-fills

**Copy last month:**
1. Navigate to a month that has NO expenses
2. If previous month has expenses, see "Pichle Mahine Se Copy" button (grey, next to "+ Add")
3. Tap it -- confirmation dialog: "March ke saare expenses copy karein April mein?"
4. Confirm -- expenses from last month appear, P&L updates
5. Button disappears (current month now has expenses)
6. Try tapping Copy again on same month -- should NOT appear (has expenses)

**Category expand/collapse:**
1. Each category header is tappable (▸ collapsed, ▾ expanded)
2. Expand Stock Purchase -- see individual supplier entries with date and amount
3. Collapse it -- only total shows
4. Categories with ₹0 show in grey

**Key numbers:**
1. If month has sales, 2x2 grid shows: Avg Bill, Total Bills, Revenue/Day, Items/Bill
2. Verify Avg Bill = Revenue / Total Bills
3. Revenue/Day = Revenue / Active selling days

**Tooltips:**
1. Tap any ⓘ icon -- Hinglish tooltip appears
2. Tap again or elsewhere -- tooltip closes

**Previous month comparison:**
1. If previous month has revenue data, P&L card shows:
   "vs March: ↑₹18,000 (+15%)" (green for improvement, red for decline)

**Edge cases:**
- Month with zero bills + zero expenses: P&L shows all zeros, "Koi expenses nahi dale" message
- Expense amount = 0 or negative: "Amount positive number hona chahiye" error
- Stock Purchase without supplier name: "Supplier name zaroori hai" error
- Copy to a month that already has expenses: "Is mahine mein pehle se expenses hain" error

---

## 22. App Development Rulebook

### What changed
- `.ai/APP_RULES.md` captures business context, UX philosophy, data integrity rules, and development guidelines

### How to test
- Read the file, verify it matches the app's current behavior

---

## Login Credentials (for QA)

| Role | Username/PIN | Password |
|------|-------------|----------|
| Admin | admin | admin123 |
| Salesman 1 | PIN: 1111 | -- |
| Salesman 2 | PIN: 2222 | -- |
| Salesman 3 | PIN: 3333 | -- |

## Quick Start

```bash
cd app
npm install
npm run dev        # starts with dev database
# Open http://localhost:3000
```
