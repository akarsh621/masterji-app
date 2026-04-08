# Master Ji Fashion House - QA Test Report

Last updated: 2026-04-08  
Mode: End-to-end + finance-integrity-first QA  
Status: Completed

---

## 1) Scope and Environment

### Source scope
- `app/README.md`
- `app/CHANGELIST.md` (sections 1-22)

### Primary release risk focus
- Billing calculation correctness
- Bookkeeping/data integrity
- Legal/tax-impacting accuracy (discounts, totals, payment splits, returns, drawer, exports)

### Execution environment
- App mode: `DB_MODE=dev`
- DB: `data/masterji_dev.db` (fresh-reset before run)
- App URL: `http://localhost:3000`
- Roles used: Admin + Salesman

### Run summary
- API deterministic + negative suite: **52 checks** (`50 pass`, `2 fail`)
- Fuzz billing suite: **25 scenarios** (`25 pass`, `0 fail`)
- Reconciliation suite: **18 checks** (`17 pass`, `1 fail`)
- UI/E2E flows: Salesman + Admin critical journeys executed; key routes validated
- Post-fix retest suite (after pushed fixes): **14 checks** (`14 pass`, `0 fail`)
- Post-fix reconciliation retest: **12 checks** (`12 pass`, `0 fail`)
- Production-mode smoke (`npm run prod`) initial: **Fail** (`/api/dashboard`, `/api/hisaab`, `/api/export` returned `500` on prod DB due missing `b.mrp_total`)
- Production-mode re-smoke after fix: **Pass** (migration `v5` applied; core admin APIs `200/200/200`)

---

## 2) QA Test Matrix and Run Summary

## Layer 1 - API + DB invariants (calculation core)

| ID | Area | Priority | Invariant to prove | Status |
|----|------|----------|--------------------|--------|
| A1 | Create bill math | P0 | `total = subtotal - discount_amount`, all rounded consistently | Pass |
| A2 | Item math constraints | P0 | `mrp > 0`, `qty > 0`, amount relationship valid | Pass |
| A3 | Payment integrity | P0 | Sum of `bill_payments` equals bill total | Pass |
| A4 | Mixed mode semantics | P0 | `mixed` only as bill-level derived mode, not payment row mode | Pass |
| A5 | Cash rounding | P0 | Cash-only round-down behavior is consistent and recorded correctly | Partial (UI sample pass; deeper round-boundary matrix still recommended) |
| A6 | Return integrity | P0 | Return linkage/authorization/amount controls and refund-side accounting | **Pass (Retest closed)** |
| A7 | Void integrity | P0 | Void reverses all financial side effects exactly once | Pass |
| A8 | Cash drawer mutation | P0 | Sale/return/cash-out/sweep/manual events reconcile to drawer | Pass |
| A9 | Dashboard aggregates | P0 | Net/gross/returns/discount/mrp/payment totals match DB truth | **Pass (prod re-smoke closed)** |
| A10 | Export aggregates | P1 | CSV financial values match API + DB for same date range | **Pass (prod re-smoke closed)** |
| A11 | Negative payload hardening | P0 | Malformed/forged/mismatched payloads rejected with clear errors | Partial (strict calendar checks fixed for dashboard/export; bills list still regex-only) |
| A12 | Fuzz stability | P1 | Randomized valid payloads keep all invariants intact | Pass |

## Layer 2 - End-to-end functional journeys

| ID | Journey | Priority | Expected outcome | Status |
|----|---------|----------|------------------|--------|
| E1 | Salesman login -> category-first bill -> save | P0 | Correct bill persisted and shown in UI summaries | Pass |
| E2 | Salesman split payment + bill-level discount | P0 | UI/DB/API totals align, no hidden mismatch | Pass |
| E3 | Admin login -> dashboard -> custom range -> export | P0 | Range filters and exported data parity | **Pass (prod re-smoke closed)** |
| E4 | Admin return/exchange flow | P0 | Valid return bill, correct net and drawer impact | **Pass (Retest closed)** |
| E5 | Admin void + recreate flow | P0 | Void accounting reversal and clean prefill recreation | Partial (void verified, recreate UI path not fully exercised) |
| E6 | Hisaab correct + sweep + cash-out chain | P0 | Drawer transitions are exact and explainable | **Pass (prod re-smoke closed)** |
| E7 | Earnings add/edit/delete/copy expenses | P1 | Monthly P&L and deltas remain correct | Pass |
| E8 | On-bill salesman selector | P1 | Bill is assigned to selected salesman correctly | Pass |
| E9 | Print queue trigger paths | P2 | Queue API path and UI behavior non-breaking | Pass |

## Layer 3 - UI stability and non-break checks

| ID | Screen | Priority | UI behavior to verify | Status |
|----|--------|----------|-----------------------|--------|
| U1 | NewBill | P0 | Category-first UX, no wrong-category accidental add path | Pass |
| U2 | Payment | P0 | Final price/%/split/rounding widgets stay stable and intuitive | Partial (works; click interception seen at viewport edges) |
| U3 | Bill Book | P0 | Filters, row expand, return/void/delete controls behave reliably | Partial (filter parity fixed; tap interception observed) |
| U4 | Dashboard | P1 | Tabs, trend toggles, loading states, custom dates work cleanly | Pass |
| U5 | Hisaab | P1 | Hero card, correct/edit/sweep forms and refresh states are stable | Pass |
| U6 | Earnings | P1 | Expense forms/list/edit/delete/copy interactions are not broken | Partial (core works; some clickable rows intercepted in viewport) |
| U7 | Settings | P1 | Core user/category/admin edit flows remain usable | Pass |
| U8 | Mobile-style interaction | P0 | No blocking overlap/intercept/focus/keyboard regressions | **Fail (Medium)** |
| U9 | Error visibility | P0 | Rejected API actions are surfaced, not silently swallowed | Pass for tested paths |

## Layer 4 - Cross-system reconciliation

| ID | Reconciliation | Priority | Expected result | Status |
|----|----------------|----------|-----------------|--------|
| R1 | Dashboard vs direct SQL | P0 | Summary values match same-period DB truth | **Pass (prod re-smoke closed)** |
| R2 | Aaj summary vs direct SQL | P0 | Salesman-facing totals match DB truth | Pass (shares validated dashboard source) |
| R3 | Hisaab vs app_state + flows | P0 | Drawer and flow breakdown are explainable and exact | **Pass (prod re-smoke closed)** |
| R4 | CSV vs API/DB | P1 | Export is financially and structurally consistent | **Pass (prod re-smoke closed)** |

---

## 3) Calculation Reconciliation Table (Expected vs Actual)

| Case | Expected (DB Truth) | Actual (API/UI) | Result |
|------|----------------------|-----------------|--------|
| Dashboard `net_revenue` (post-fix retest) | `1080` | `1080` | Pass |
| Dashboard `total_discount` (true MRP gap) | `520` | `520` | Pass |
| Dashboard/Hisaab payment split (`cash/upi/card`) | `0 / 1080 / 0` | `0 / 1080 / 0` | Pass |
| Hisaab `cash_drawer` | `0` | `0` | Pass |
| Hisaab `sales.total_discount` | `520` | `520` | Pass |
| CSV row count (today range) | `4` | `4` | Pass |
| CSV rounded total sum | `2680` | `2680` | Pass |
| Invalid date guard - dashboard (`2026-13-01`) | `400` | `400` | Pass |
| Invalid date guard - export (`2026-15-01`) | `400` | `400` | Pass |
| Prod smoke core admin APIs (`dashboard/hisaab/export`) | `200/200/200` | `200/200/200` | Pass |

---

## 4) Findings (Severity Ordered)

### Critical
- None open in post-fix retest + prod re-smoke.

### High
- None open in post-fix retest.

### Medium
- F-005: Repeated click/tap interception in mobile-style viewport on critical actions (carry-forward observation; non-blocking to finance integrity).

### Low
- None in this pass.

---

## 5) Detailed Findings (RCA + Repro + Fix + Retest)

### F-001 - Duplicate returns allowed for same source quantity
- **Severity:** Critical
- **Area:** Returns API, financial integrity
- **Impact:** Same sold item can be returned multiple times, leading to over-refunds, negative revenue distortion, and drawer corruption.
- **Repro:** `POST /api/bills/:id/return` for same bill + item + qty succeeds repeatedly (`201`, two return bill IDs created).
- **Evidence:** QA API run created `ret1` and `retAgain` successfully for same original quantity.
- **RCA:** Route validates requested qty against original line qty per request only; it does not subtract previously returned quantity for that original bill.
- **Fix direction:** Enforce cumulative return caps per original bill line (`already_returned_qty + requested_qty <= sold_qty`) and block when exceeded.
- **Retest criteria:** Second return attempt for fully returned line must return `400`.
- **Retest result (post-fix):** **Closed**. Duplicate return attempt now returns `400`.

### F-002 - Inflated return amount accepted
- **Severity:** Critical
- **Area:** Returns API, calculation integrity
- **Impact:** Operator can submit refund amount much higher than sold value, causing direct financial loss and accounting fraud risk.
- **Repro:** Return request with line `amount=9999` for originally sold lower-value item succeeded (`201`).
- **Evidence:** QA API run `retInflated` accepted with `refund_amount: 9999`.
- **RCA:** Route checks only positive finite amount; no amount-to-original line validation.
- **Fix direction:** Enforce line amount cap based on original sold unit amount and returned quantity (with small rounding tolerance).
- **Retest criteria:** Any return line amount above original proportional sold value must return `400`.
- **Retest result (post-fix):** **Closed**. Inflated amount return attempt now returns `400`.

### F-003 - Hisaab discount does not match true discount model
- **Severity:** High
- **Area:** `GET /api/hisaab`, reporting consistency
- **Impact:** Operational discount shown in Hisaab understates true discount and can mislead bookkeeping and tax review.
- **Repro:** Reconciliation run: Hisaab `sales.total_discount=24898.42` vs dashboard/DB true discount `91625.42`.
- **RCA:** Hisaab query sums only `b.discount_amount`, while dashboard uses true discount expression derived from `mrp_total - total` for sale bills.
- **Fix direction:** Use same discount expression in Hisaab as dashboard for sale rows.
- **Retest criteria:** Hisaab discount must equal dashboard and direct SQL truth for identical date range.
- **Retest result (post-fix):** **Closed**. `hisaab.sales.total_discount` now matches dashboard and DB truth.

### F-004 - Date format validation accepts invalid calendar dates
- **Severity:** High
- **Area:** Date-filtered APIs (`dashboard`, `export`, also similar pattern in list endpoints)
- **Impact:** Invalid user input can silently pass and produce confusing or incorrect reports.
- **Repro:** `GET /api/dashboard?from=2026-13-01` and `GET /api/export?from=2026-15-01` returned `200` instead of validation error.
- **RCA:** Regex validates string shape only (`YYYY-MM-DD`), not real calendar validity.
- **Fix direction:** Parse and validate dates with strict calendar semantics before query execution.
- **Retest criteria:** Impossible dates must return `400` with clear error.
- **Retest result (post-fix):** **Closed** for dashboard/export. Invalid month requests now return `400`.

### F-005 - Click interception in mobile-style viewport on critical actions
- **Severity:** Medium
- **Area:** UI interaction layer (`Payment`, `Bill Book`, `Earnings`)
- **Impact:** Users may struggle to trigger key actions reliably on some viewport/layout combinations.
- **Repro:** Multiple actions required edge-offset clicks due intercepted targets during QA runs.
- **RCA:** Layering/overlap of non-interactive elements with actionable controls in specific viewport positions.
- **Fix direction:** Audit `z-index`, `pointer-events`, sticky/footer overlap, and spacing around action areas.
- **Retest criteria:** All critical buttons should click reliably at center tap position without offset workarounds.
- **Retest result (post-fix):** Not part of current API-focused fix push; keep as non-blocking UI observation.

### F-006 - Production smoke failure due DB schema drift
- **Severity:** Critical
- **Area:** Production-mode runtime (`DB_MODE=prod`) schema compatibility
- **Impact:** Core admin reporting endpoints fail in production mode (`/api/dashboard`, `/api/hisaab`, `/api/export`), blocking day-close visibility and exports.
- **Repro:** Start with `npm run prod`; login succeeds; calling those endpoints returns `500`.
- **Evidence:** Server logs show `SqliteError: no such column: b.mrp_total` while preparing those queries.
- **RCA:** Production DB schema is older and does not include `bills.mrp_total`; current migrations do not add this column for legacy prod DBs.
- **Fix direction:** Add forward-safe migration that adds `mrp_total REAL DEFAULT 0` to `bills` when absent, plus optional backfill where possible.
- **Retest criteria:** Under `npm run prod`, dashboard/hisaab/export all return `200` and reconcile with DB truth.
- **Retest result (post-fix):** **Closed**. Startup logs show migration `v5` applied, and re-smoke confirms `dashboard/hisaab/export` all return `200`.

---

## 6) Go/No-Go Verdict

- **Release readiness:** **GO**
- **Blocking risks:** No open Critical/High findings after prod re-smoke.
- **Recommendation:** Proceed to rollout candidate; keep medium UI tap-interception as follow-up hardening.

---

## 7) Next Actions for Development

- Keep automated regression tests for returns (duplicate qty + amount cap) in CI.
- Extend strict `isValidDate` utility usage to endpoints still using regex-only checks (for consistency).
- Verify migration `v5` rollout across all deployed databases/environments.
- Resolve viewport click/tap interception in payment/history/earnings and run focused mobile viewport UX pass.
- Keep production smoke checklist in pre-release gate (`dashboard`, `hisaab`, `export`, auth, filters).

