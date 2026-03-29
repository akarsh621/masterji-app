# Changelist -- Master Ji Fashion House App

Last updated: 2026-03-21

This document lists every change made with step-by-step test instructions for QA handoff.

**Data impact:** This sprint rewrote the schema from scratch (no migrations needed). If upgrading from an older version, delete `data/masterji_dev.db` and restart: `npm run dev` (auto-seeds on empty DB).

---

## 1. Technical Debt Cleanup

### What changed
- Removed unused `recharts` dependency from `package.json`
- Deleted `app/backend/` and `app/frontend/` folders (old prototype, not in use)
- Created `.gitignore` (excludes `node_modules/`, `.next/`, `data/`, `.env.local`)
- Removed hardcoded JWT secret fallback in `src/lib/auth.js` -- app now requires `JWT_SECRET` in `.env.local`

### Files touched
- `package.json`, `.gitignore`, `src/lib/auth.js`, `backend/` (deleted), `frontend/` (deleted)

### How to test
1. Run `npm run dev` -- app should start without errors
2. Verify `backend/` and `frontend/` folders are gone
3. Delete `.env.local` temporarily, run `npm run dev` -- should see error: "JWT_SECRET environment variable is not set"
4. Restore `.env.local`, restart -- should work normally

---

## 2. Clean Schema (No Migrations)

### What changed
- Schema includes `bills.type`, `bills.original_bill_id`, `bills.payment_mode` (with `'mixed'`), `bills.mrp_total`, `bill_payments`, `cash_out`, and `app_state` tables
- No migration code -- clean slate since no legacy production data

### Files touched
- `src/lib/db/schema.sql`, `src/lib/db/index.js`

### How to test
1. Delete `data/masterji_dev.db` if it exists
2. Run `npm run dev` -- auto-seeds, should start without errors
3. Verify all API endpoints work

---

## 3. Split/Mixed Payment Support

### What changed
- `bill_payments` table stores per-payment-mode amounts
- Bills API accepts `payments: [{ mode, amount }]` array
- `bills.payment_mode` = `'mixed'` when multiple modes used, single mode otherwise
- Dashboard/TodaySummary aggregate cash/UPI/card totals from `bill_payments`
- CSV export includes "Payment Split" column
- SalesHistory filter dropdown includes "Mixed" option

### Files touched
- `src/lib/db/schema.sql`, `src/app/api/bills/route.js`, `src/app/api/dashboard/route.js`, `src/app/api/export/route.js`, `src/lib/api-client.js`, `src/components/NewBill.js`, `src/components/SalesHistory.js`, `src/components/TodaySummary.js`, `src/components/Dashboard.js`

### How to test

**Single payment:**
1. Login as salesman (PIN: 1111), create a bill with any items
2. Cash is selected by default -- save bill
3. Check History -- bill shows Cash
4. Check Dashboard (admin login: admin/admin123) -- Cash total includes this amount

**Split payment:**
1. Create a bill totaling e.g. Rs 1000
2. Tap "Split Payment?" -- it turns blue, second mode selector appears
3. Select UPI as second mode, enter Rs 400 in split amount
4. Verify breakdown: "Cash: Rs 600 + UPI: Rs 400"
5. Save -- check History (expanded bill shows "Payment Split")
6. Check Dashboard -- Cash +Rs 600, UPI +Rs 400
7. Filter History by "Mixed" -- shows only split bills

**Edge cases:**
- Split amount = 0, > total, or = total --> behaves as single payment
- Same mode for primary and split --> split mode auto-changes

---

## 4. Returns/Exchanges

### What changed
- Bills have `type` (`'sale'`/`'return'`) and `original_bill_id` linking returns to original sale
- API: `POST /api/bills/:id/return` creates a return bill
- Dashboard shows net revenue (gross - returns), return count
- Return bills styled with red left border + "RETURN" tag

### Files touched
- `src/lib/db/schema.sql`, `src/app/api/bills/[id]/return/route.js`, `src/app/api/bills/route.js`, `src/app/api/dashboard/route.js`, `src/components/SalesHistory.js`, `src/components/TodaySummary.js`, `src/components/Dashboard.js`

### How to test

**Process a return:**
1. Login as admin, go to History, expand a sale bill
2. Tap "Return / Exchange" (left side, orange bordered button)
3. Use +/- to select return quantities, select refund mode
4. Tap "Return Confirm"
5. New bill appears with red "RETURN" tag and negative amount
6. Dashboard net revenue decreased by return amount

**Edge cases:**
- Return more than original qty --> blocked
- Return from a return bill --> error
- Return as salesman --> "Return / Exchange" button IS visible (salesmen can process returns)

---

## 5. Cash Out Log

### What changed
- `cash_out` table tracks cash leaving the drawer (expense, supplier, owner, other)
- API: `POST /api/cash-out` and `GET /api/cash-out`
- Hisaab tab integrates cash-out into drawer reconciliation

### Files touched
- `src/lib/db/schema.sql`, `src/app/api/cash-out/route.js`, `src/lib/api-client.js`, `src/components/DayClose.js`

### How to test
1. Login as admin, go to Hisaab tab
2. Tap "Cash Out Record Karo"
3. Enter Rs 200, select "Kharcha", note "Chai for team"
4. Save -- drawer decreases by Rs 200, entry appears in "Aaj ke Cash Out"
5. Record supplier payment Rs 500, owner withdrawal Rs 1000
6. Verify all categories appear in Cash Flow breakdown

---

## 6. Bill Correction (Void + Re-create)

### What changed
- Salesman can cancel own bill within 15 minutes
- Admin can void any bill anytime
- After void, admin gets "Iske badle naya bill banao?" prompt --> opens NewBill pre-filled

### Files touched
- `src/app/api/bills/[id]/route.js`, `src/components/SalesHistory.js`, `src/components/AppShell.js`, `src/components/NewBill.js`

### How to test

**Salesman self-void:**
1. Login as salesman, create a bill
2. Go to History -- see "Galat hai? Cancel karo" on the right side of the bill
3. Tap it -- bill voided
4. After 15 minutes, button disappears on older bills

**Admin void + recreate:**
1. Login as admin, History, expand bill, click "Void Bill"
2. Confirm --> "Iske badle naya bill banao?" --> OK
3. NewBill tab opens with items pre-filled, modify and save

---

## 7. Custom Date Range in Dashboard

### What changed
- "Custom" pill next to Aaj/Hafta/Mahina, shows from/to date pickers

### Files touched
- `src/components/Dashboard.js`

### How to test
1. Admin Dashboard, tap "Custom", set date range, tap "Apply"
2. Data shows only that range; Export CSV respects range

---

## 8. Period-over-Period Comparison

### What changed
- Dashboard API returns `previous_summary` (today vs yesterday, week vs prev 7 days, etc.)
- Green/red delta badges on revenue, bill count, avg bill value

### Files touched
- `src/app/api/dashboard/route.js`, `src/components/Dashboard.js`, `src/components/TodaySummary.js`

### How to test
1. Create bills today, go to Dashboard
2. If yesterday had different totals, delta badges appear (e.g. "+25%" in green)

---

## 9. Persistent Cash Drawer

### What changed
- `app_state` table with single-row `cash_drawer` value
- Every cash event atomically updates drawer in same DB transaction
- API: `GET /api/cash-drawer` (read) and `PUT /api/cash-drawer` (admin manual correction)
- Hisaab shows live drawer balance with "Correct Karo" for admin

### Files touched
- `src/lib/db/schema.sql`, `src/lib/db/index.js`, `src/app/api/bills/route.js`, `src/app/api/bills/[id]/route.js`, `src/app/api/bills/[id]/return/route.js`, `src/app/api/cash-out/route.js`, `src/app/api/hisaab/route.js`, `src/app/api/cash-drawer/route.js`, `src/components/DayClose.js`

### How to test
1. Fresh DB --> Hisaab shows ₹0
2. Create cash bill Rs 500 --> drawer ₹500
3. Split bill Rs 600 cash + Rs 200 UPI --> drawer ₹1,100
4. Cash out Rs 100 --> drawer ₹1,000
5. Void the Rs 500 bill --> drawer ₹500
6. Admin "Correct Karo" to ₹5,000 --> drawer ₹5,000, continues from there

---

## 10. Dev vs Prod Database

### What changed
- `DB_MODE=dev` uses `masterji_dev.db`, prod uses `masterji.db`
- Amber "DEV MODE" banner in dev mode
- `npm run dev` = dev DB, `npm run prod` = prod DB

### Files touched
- `src/lib/db/index.js`, `src/lib/db/seed.js`, `package.json`, `src/app/api/auth/me/route.js`, `src/context/auth.js`, `src/components/AppShell.js`

### How to test
1. `npm run dev` --> amber "DEV MODE" banner, uses `masterji_dev.db`
2. `npm run prod` --> no banner, uses `masterji.db`, dev data not visible

---

## 11. Salesman History Tab

### What changed
- Salesmen now have 3 tabs: Naya Bill, Aaj, History (shows only their own bills)

### How to test
1. Login as salesman, verify 3-tab nav
2. History shows only this salesman's bills

---

## 12. Admin Username/Password Change

### What changed
- Admin "Edit" button in Settings for name, username, password changes

### How to test
1. Admin Settings, Edit, change password, save, logout
2. Old password fails, new password works
3. Change username -- old username fails, new works

---

## 13. Script Naming

### What changed
- `npm run dev` = dev DB (`DB_MODE=dev`), `npm run prod` = prod DB

### How to test
- `npm run dev` shows DEV banner, `npm run prod` does not

---

## 14. "Final ₹" Discount Rounding Fix

### What changed
- Frontend sends both `discount_percent` and `discount_amount`; backend uses `discount_amount` directly
- Prevents rounding mismatches (e.g. customer says "1100 kar do" on Rs 1300 bill)

### How to test
1. Bill Rs 1300, "Final ₹" = 1100 --> total must be exactly ₹1100, not ₹1105
2. "% Off" 20 on Rs 1000 --> total ₹800, discount 20%/₹200

---

## 15. QA Fixes -- Discount Fallback + Payment Validation

### What changed
- Backend derives `discount_amount` from `discount_percent` if `discount_amount` is 0/missing
- `'mixed'` rejected as a per-payment mode (it's a derived bill-level value only)

### How to test
1. API: POST bill with `discount_percent: 20`, no `discount_amount` --> correct total
2. API: POST bill with `mode: "mixed"` in payments --> 400 error

---

## 16. Billing UX Overhaul v2 -- MRP + Discount % Input

### What changed
- **Item input model changed**: Salesman enters MRP (tag price) + Discount % instead of a selling price. App computes selling price live: `₹1200 - 20% = ₹960`.
- **Live calculation display**: Orange text below inputs shows the math as salesman types.
- **Item list display overhauled**:
  - Each row: `1. Kurti ×1` with "Hatao" button on right
  - Below: `₹1200 - 20% = ₹960` in dark grey, bold selling amount on right
  - Header shows total piece count (e.g. "2 items")
  - Summary footer: total items count + total amount
- **Payment screen bill preview**: Shows all items with MRP, discount %, selling price line-by-line (like a paper bill). MRP Total, Selling Total, and Discount displayed.
- **Schema**: `bill_items.mrp` column stores MRP per item.

### Files touched
- `src/components/NewBill.js` (complete rewrite of Screen 1 and Screen 2 UI)
- `src/lib/db/schema.sql` (`bill_items.mrp` column)
- `src/lib/db/index.js` (embedded schema updated)

### How to test

**Adding items (Screen 1):**
1. Login as salesman (PIN: 1111)
2. Tap "Kurti" category --> input section appears (MRP, Discount %, Qty, Add)
3. Enter MRP: 1200, Discount: 20 --> see live calculation "₹1200 - 20% = ₹960"
4. Tap "+ Add" --> item added to list, input section collapses, category deselects
5. Item row shows: `1. Kurti ×1` / `₹1200 - 20% = ₹960` / **₹960** bold on right / "Hatao" button
6. Tap another category (e.g. "Top") --> input reappears, MRP focused
7. Enter MRP: 500, Discount: 10 --> "₹500 - 10% = ₹450", Add
8. Summary shows "2 items" and total ₹1,410

**Payment screen (Screen 2):**
1. Tap "Payment Karo" button
2. Bill Preview card shows each item with MRP and discount calculation
3. MRP Total, Selling Total, and Discount line all visible
4. "← Items Edit Karo" is a filled blue button (obvious for going back)

**Edge cases:**
- MRP = 0 or negative --> Add button stays disabled
- Discount > 100% --> selling price goes to 0, Add disabled
- No discount (0%) --> shows "₹500 (no discount)", item added at MRP price

---

## 17. Category-First Billing Flow (No Auto-Select)

### What changed
- **Default state**: Page loads with ONLY category pills visible + bill items (if any). No input fields, no category pre-selected.
- **Category tap**: Highlights category, slides in input section (MRP, Discount %, Qty, Add), focuses MRP input.
- **After adding item**: Input section collapses (`selectedCategoryId = null`), category deselects. Salesman sees categories + bill.
- **No autoFocus on page load**: Mobile keyboard never auto-opens. Focus only happens after explicit category tap.
- **Empty state message**: "↑ Category chuno — phir item add karo" when no items and no category selected.
- **Why**: Prevents wrong-category mistakes when salesmen are in a hurry. On mobile, keyboard covering the screen was hiding categories and causing accidental adds.

### Files touched
- `src/components/NewBill.js` (removed auto-select useEffect, conditional render of input section, setSelectedCategoryId(null) after add, focus on category tap)

### How to test

**Default state:**
1. Login as salesman, you're on Naya Bill tab
2. Only category pills visible (Kurti, Top, Palazzo/Pant, etc.)
3. NO input fields visible (no MRP, no Discount %, no Add button)
4. Message: "↑ Category chuno — phir item add karo"
5. **Mobile keyboard is NOT open**

**Category tap flow:**
1. Tap "Kurti" --> category highlights blue, label "Adding: Kurti (Ladies)" appears
2. Input section slides in: MRP, Discount %, Qty (1/2/3+), + Add
3. MRP input is focused (keyboard opens NOW, after explicit tap)
4. Enter MRP: 800, Discount: 15
5. Tap "+ Add"
6. **Input section disappears**, category deselects (no highlight)
7. Item visible in list: "1. Kurti ×1" with "₹800 - 15% = ₹680"
8. Categories visible again for next item

**Rapid adding (the key test):**
1. Tap "Kurti" --> add item at ₹800
2. Input collapses. Tap "Top" --> input reappears for Top category
3. Add item at ₹500
4. Input collapses. Tap "Palazzo/Pant" --> input appears for Palazzo
5. At NO point should a salesman accidentally add an item under the wrong category

**Going back to edit:**
1. After adding items, tap "→ Payment Karo"
2. On payment screen, tap "← Items Edit Karo" (filled blue button)
3. Back on item screen -- all items still there, no category selected, input hidden

---

## 18. True Discount Tracking (MRP Total on Bills)

### What changed
- **Problem**: Previously `bills.discount_amount` only stored the extra bill-level discount (from "Final Price Set Karo?" on payment screen). Per-item MRP-to-selling-price discount was invisible in dashboard and history -- it was baked into item amounts but never tracked on the bill.
- **Solution**: New `bills.mrp_total` column stores the sum of all item MRPs (MRP × quantity). True total discount = `mrp_total - total` (captures BOTH per-item haggling AND bill-level extra discount).
- **Backend**: `POST /api/bills` computes `mrp_total` server-side from items and stores it.
- **Frontend**: Also sends `mrp_total` for redundancy.
- **Dashboard**: `total_discount` now uses `SUM(mrp_total - total)` instead of `SUM(discount_amount)`. New `total_mrp` field for percentage calculation.
- **SalesHistory collapsed row**: Shows "₹300 off" (in orange) derived from `mrp_total - total`.
- **SalesHistory expanded row**: Each item shows MRP breakdown (e.g. "₹1200 - 20% = ₹960"). Footer shows "Total Discount (23% off MRP) -₹300".
- **TodaySummary**: Fixed NaN% bug (was referencing removed `avg_discount_percent` field).

### Files touched
- `src/lib/db/schema.sql` (added `bills.mrp_total REAL DEFAULT 0`)
- `src/lib/db/index.js` (embedded schema updated)
- `src/app/api/bills/route.js` (computes and stores `mrp_total`)
- `src/app/api/dashboard/route.js` (`total_discount` = `mrp_total - total`, added `total_mrp`)
- `src/components/Dashboard.js` (label: "Total Discount (MRP se)", uses `total_mrp`)
- `src/components/TodaySummary.js` (fixed NaN%, uses `total_mrp`)
- `src/components/SalesHistory.js` (true discount in collapsed/expanded views, per-item MRP breakdown)

### How to test

**Verify discount shows on Aaj tab (the main fix):**
1. Login as salesman, create a bill: Kurti MRP ₹1000 at 20% off = ₹800. No extra discount. Save.
2. Go to Aaj tab --> should show: "-₹200" under "Total Discount Diya (20% off MRP)"
3. Previously this showed ₹0 because per-item discount wasn't tracked at bill level.

**Verify with extra discount too:**
1. Create bill: Top MRP ₹500 at 10% off = ₹450
2. On payment, tap "Final Price Set Karo?" --> set final price ₹400
3. Save bill
4. Aaj tab: total discount should be cumulative (₹200 from bill 1 + ₹100 from bill 2 = ₹300)
5. **Percentage should NOT be NaN** -- should show a valid number like "18% off MRP"

**Verify in History:**
1. Go to History, find the bill
2. Collapsed row: should show "₹100 off" in orange text next to payment mode
3. Expand bill: each item shows MRP and discount calculation
4. Footer: "Total Discount (20% off MRP) -₹100"

**Admin Dashboard:**
1. Login as admin, go to Dashboard
2. "Total Discount (MRP se)" card shows total across all bills with valid percentage

---

## 19. Payment Screen UX Improvements

### What changed
- **"Final Price Set Karo?"** button (was "Extra Discount?" then "Aur Discount Dena Hai?") -- clearer intent for salesmen
- **"Lagao" (Apply) button** next to discount input: tapping it blurs the input field, which dismisses the mobile keyboard so salesman can see the result without manually closing keyboard
- **Discount result display**: When bill-level discount is applied, shows orange box: "₹1120 se ₹120 off" and "Final: ₹1000" in green
- **"Discount" label** in bill preview (was "Per-item Discount") -- simpler, shows the overall item-level savings
- **Total Discount line**: Clean text style (was orange bar accent, removed per feedback)
- **"← Items Edit Karo" button**: Changed from ghost/outline to **filled blue** button -- salesmen were using the phone's hardware back button (which exits the app) instead of this button because it wasn't obvious enough

### Files touched
- `src/components/NewBill.js` (all payment screen changes)

### How to test

**"Final Price Set Karo?" flow:**
1. Add items, go to Payment
2. See "Final Price Set Karo?" button (orange outlined)
3. Tap it --> "Final ₹" tab is active by default, input appears with placeholder "Selling ₹1470 — final kitna?"
4. Type "1400"
5. Tap "Lagao" --> keyboard dismisses, result box shows: "₹1470 se ₹70 off" and "Final: ₹1400"
6. Total Discount line shows combined item + bill discount
7. "Bill Save Karo" button shows ₹1,400

**Switch to % Off:**
1. Tap "% Off" tab
2. Type "10"
3. Tap "Lagao" --> keyboard dismisses
4. Result shows calculation

**"Hatao" to remove discount:**
1. Tap "Hatao" (red button) --> discount removed, reverts to selling total

**Items Edit Karo button:**
1. On payment screen, verify "← Items Edit Karo" is a filled blue button (not ghost/outline)
2. Tap it --> goes back to items screen with all items preserved

---

## 20. SalesHistory Button Layout Fix

### What changed
- **"Return / Exchange" button**: Moved to left, given orange border + background (`border-orange-300 bg-orange-50`) -- obvious tappable button, not just a text link
- **"Cancel karo" button**: Stays on right side using `justify-between` layout on the button row
- Buttons separated by a top border for visual grouping

### Files touched
- `src/components/SalesHistory.js`

### How to test
1. Login as salesman, go to History, expand a recent bill (< 15 min old)
2. Bottom row: "Return / Exchange" on LEFT with orange border, "Galat hai? Cancel karo" on RIGHT
3. Buttons should NOT overlap -- clear separation
4. Login as admin, expand a bill: "Return / Exchange" on left, "Void Bill" text on right

---

## 21. App Development Rulebook

### What changed
- Created `.ai/APP_RULES.md` -- captures business context, UX philosophy, data integrity rules, and development guidelines for any future developer or AI agent
- Key sections: why Hinglish, category-first flow, no autoFocus on load, calculator replacement, data integrity, deferred features list

### Files touched
- `.ai/APP_RULES.md` (created)

### How to test
- Read the file, verify it matches the app's current behavior
- Any future development should follow these rules

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
