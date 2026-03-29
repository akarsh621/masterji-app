# Master Ji Fashion House - QA Test Report

Last updated: 2026-03-21  
Prepared for: Development handoff (billing-critical validation)

---

## Release Readiness Verdict

**Status: NOT READY FOR SHOP ROLLOUT**

Core billing math is mostly stable under normal UI flow, but multiple open issues can still cause serious bookkeeping risk (including a critical return-forgery path that can manipulate drawer balance).

---

## Scope Covered in This Pass

- Full review basis: `CHANGELIST.md` (through section 21)
- Backend API stress tests (auth, bills, returns, dashboard, export, cash drawer)
- DB-level validation against stored values (`bills`, `bill_items`, `bill_payments`, `app_state`)
- Frontend/browser validation on `localhost:3000` for salesman + admin flows
- Edge-case and negative-case probes focused on bill math integrity

---

## Environment

- App mode: `DB_MODE=dev`
- DB: fresh seeded `data/masterji_dev.db`
- Server: Next.js dev server on `http://localhost:3000`
- Test credentials:
  - Admin: `admin / admin123`
  - Salesman: PIN `1111`

---

## Open Findings (with RCA + Fix Direction)

## 1) CRITICAL - Salesman can forge return bills via `POST /api/bills`

- **Area:** Billing / Returns / Cash drawer integrity
- **Status:** Open
- **Impact:** Any authenticated salesman can create arbitrary `type='return'` bills (including cash refunds) without using the protected return route. This can directly reduce drawer and distort revenue/return accounting.
- **Repro (confirmed):**
  - `POST /api/bills` as salesman with body containing `type: "return"` succeeded (`201`).
  - Also succeeded without `original_bill_id` ("phantom return").
- **RCA:**
  - `src/app/api/bills/route.js` allows `billType` from request body (`requireAuth` only).
  - No role gate for return creation in this route.
  - No mandatory linkage validation to original sale bill.
- **Fix direction:**
  - In `POST /api/bills`, force `type='sale'` only; reject any client-provided `type`/`original_bill_id`.
  - Keep returns exclusively in `POST /api/bills/:id/return`.
  - Add server-side assertion: return creation requires valid original sale bill and authorized role.
- **Retest criteria:**
  - Salesman `POST /api/bills` with `type='return'` => `400/403`.
  - Phantom return (missing `original_bill_id`) => rejected.

---

## 2) HIGH - Salesman return workflow broken (UI allows action, API denies)

- **Area:** Frontend + API contract mismatch
- **Status:** Open
- **Impact:** Salesman sees return action in history, but submit fails with auth error. Operational confusion during real counter usage.
- **Repro (confirmed):**
  - Salesman call to `POST /api/bills/:id/return` returns `403` (`"Sirf admin access kar sakta hai"`).
- **RCA:**
  - `src/components/SalesHistory.js` exposes return action to salesmen.
  - `src/app/api/bills/[id]/return/route.js` uses `requireAdmin`.
- **Fix direction (choose one):**
  - Option A: Allow salesman in return route with strict constraints.
  - Option B: Hide/disable return UI for salesmen.
- **Retest criteria:**
  - UI visibility and API authorization behavior must match exactly.

---

## 3) HIGH - "Mixed" payment filter broken in history

- **Area:** Sales history filtering
- **Status:** Open
- **Impact:** Users selecting Mixed filter get backend `400`; UI silently keeps stale list, giving false confidence in filtered data.
- **Repro (confirmed):**
  - API call `GET /api/bills?...&payment_mode=mixed` returned `400` (`Payment mode galat hai`).
  - Browser network confirms `statusCode: 400` on Mixed filter search.
- **RCA:**
  - `VALID_PAYMENT_MODES` was narrowed to `cash/upi/card` for payment entry validation.
  - Same set is also reused in `GET /api/bills` filter validation, accidentally rejecting bill-level `mixed`.
- **Fix direction:**
  - Separate constants:
    - `VALID_PAYMENT_ENTRY_MODES = {cash, upi, card}`
    - `VALID_BILL_FILTER_MODES = {cash, upi, card, mixed}`
  - Surface filter API error in UI instead of silent catch.
- **Retest criteria:**
  - Mixed filter returns only mixed bills in both admin and salesman history.

---

## 4) HIGH - Dashboard discount % denominator includes return subtotals

- **Area:** Analytics accuracy (tax/reconciliation visibility)
- **Status:** Open
- **Impact:** `Total Discount (MRP se)` percentage can be understated when return bills exist.
- **Repro (confirmed):**
  - Dashboard summary `total_mrp` was higher than sales-only MRP by exactly return subtotal.
  - Example observed difference: `+800` (matching one return bill subtotal).
- **RCA:**
  - In `src/app/api/dashboard/route.js`, `total_mrp` uses:
    - `CASE WHEN b.type = 'sale' AND b.mrp_total > 0 THEN b.mrp_total ELSE b.subtotal END`
  - For returns, ELSE branch injects return `subtotal` into `total_mrp`.
- **Fix direction:**
  - Restrict denominator to sale bills only:
    - `SUM(CASE WHEN b.type='sale' THEN COALESCE(NULLIF(b.mrp_total,0), b.subtotal) ELSE 0 END)`
- **Retest criteria:**
  - Admin dashboard discount % must match DB-computed `(sum(sale_mrp_total-total)/sum(sale_mrp_total))`.

---

## 5) HIGH - Backend accepts item `amount` greater than `mrp * quantity`

- **Area:** Billing input validation
- **Status:** Open
- **Impact:** Inflated selling amount can be persisted, producing logically invalid "negative discount" cases and potential accidental overbilling if frontend regresses.
- **Repro (confirmed):**
  - `POST /api/bills` with `mrp=100, quantity=1, amount=200` succeeded (`201`).
- **RCA:**
  - `src/app/api/bills/route.js` validates only positive finite numbers, not pricing relationship.
- **Fix direction:**
  - Enforce when `mrp` is present:
    - `amount <= mrp * quantity` (+ small rounding tolerance)
  - Return clear validation error on violation.
- **Retest criteria:**
  - Above payload must return `400`.

---

## Calculation Validation - What Passed

- Deterministic scenario checks passed:
  - Correct persistence for `subtotal`, `mrp_total`, `discount_amount`, `total`
  - Percent fallback works: `discount_percent` without `discount_amount` derived correctly
  - Split payment sums enforced against total
  - Cash drawer updates and void reversals were mathematically correct (`+333` then `-333` exact)
- Fuzz tests passed:
  - 30 randomized bill payloads validated against DB invariants with **0 failures**
- UI calculation display checks passed:
  - MRP + discount live formula visible
  - Final price mode updates payable amount exactly
  - Split preview math (`primary + split = total`) displayed correctly
  - Today summary discount percent no longer shows `NaN`

---

## Immediate Dev Priorities (Order)

1. Block forged/phantom returns in `POST /api/bills` (Critical)
2. Align salesman return UX and authorization
3. Fix mixed history filter backend validation + UI error handling
4. Correct dashboard `total_mrp` denominator logic
5. Add amount-vs-MRP relationship validation

---

## Retest Plan After Fixes

- Re-run full billing API matrix (sale, split, final discount, percent discount, returns, voids)
- Re-run role matrix (admin vs salesman) for return/cancel actions
- Re-run history filters (`cash`, `upi`, `card`, `mixed`)
- Re-check dashboard discount percentage against direct DB truth query
- Re-run fuzz (>=30 random payloads) and confirm zero invariant breaks

