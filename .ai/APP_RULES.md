# Master Ji Fashion House -- Developer Guidelines

The rules for anyone (developer or AI agent) changing this codebase. Read `.ai/PROJECT_OVERVIEW.md` first for what the app is and how it is built; this file says **how to work on it**.

Last updated: 2026-09-26

---

## 1. The guiding principle (from the owner)

This is an app for a **budget clothing shop**, used by non-technical parents and even less technical salesmen who moved from paper. Every change must pass one test:

> **Is it absolutely necessary, and does it make things work the way people already expect?**
> Not "is this how an app should be built."

- **Fix what's broken; don't redesign what works.** Familiar screens, layouts and wording stay unless they produce wrong numbers or lose work.
- **Invisible safety is fine; visible process is not.** Backups, tests, rate limiting and correct maths add no steps for anyone. New flows, extra confirmations and reworded screens do -- they need a strong reason.
- **Convenience over purity where it helps the shop.** Example: salesman PINs stay visible on the admin screen; that saves the owner time and is worth more here than hashing them.
- **Don't add features that weren't asked for.** Suggest them; build only on a yes.

---

## 2. The users

**The salesmen are not technical and not very literate in English. They use basic Android phones, fast, during rush hours, with a customer waiting.**

- Every action must be obvious without training. No "modes", "toggles" or settings screens for them.
- The app must never be slower than paper.
- They make mistakes under pressure -- the design must prevent wrong entries (category-first billing, no pre-selected payment mode, sanity limits).
- The phone keyboard hides half the screen: **never open it unless the user just tapped something that needs typing.**
- Mobile browsers behave differently from desktop. Test on phone size, and don't rely on browser pop-ups (see 4.9).

---

## 3. Language

Balanced Hinglish, the way the shop actually talks:

- **English for technical and common terms**: Cash, UPI, Card, MRP, Discount, Total, Return, Net Profit, Customer name, Search, Filters, Print, Settings.
- **Hinglish for casual phrases and short instructions**: "Naya Bill Banao", "Hatao", "Bill Save Karo", "Payment mode chuno", "Pichla bill abhi bacha hai", "Bill cancel karo", "MRP bahut zyada hai — check karo".
- **Don't over-translate.** "Customer name", not "Grahak ka naam"; "Colour", not "Rang". Never replace an established English label with Hindi.
- Write labels the way a shopkeeper would say them out loud. Buttons say what they do ("Hatao", not "×"; "Bill Save Karo", not "Submit").
- Use correct plurals ("1 item", "2 items"; "1 bill", "2 bills").
- Error messages are short Hinglish sentences that say what to do next.

---

## 4. UX rules

Learned from real use in the shop. Follow them strictly.

1. **Category-first billing.** Only category pills and the bill are visible by default. Tapping a category reveals MRP / Discount % / Qty / Add and focuses MRP. After Add, the input collapses and the category deselects.
2. **No autofocus on load.** `autoFocus` only right after an explicit tap (a category, the Total, a note chip). Never on mount.
3. **The app replaces the calculator.** Keep the live `₹1200 - 20% = ₹960` line. Selling price never rounds above MRP.
4. **Final price is visible and bold** on every line and on the Total. Tapping an amount edits exactly what is shown (a line total edits the line total).
5. **Paper-bill feel on the payment screen.** Bill Preview lists every item, MRP total, discount, and the item count in black (it is something to check).
6. **Hide infrequent features behind labelled chips** (Split Payment, Note, backdate, Sale by). Don't clutter the default view.
7. **No default payment mode.** Nothing pre-selected, ever -- not on load, not after a save, not after the items change. Save without a mode shows "Payment mode chuno"; the Save button stays tappable.
8. **Tap targets are big enough to hit without bloating rows.** Small text buttons (Hatao) get padding with negative margins so the hit area is large but the list stays tight. No filled boxes around secondary actions.
9. **Confirmations use the in-app box, not `window.confirm`.** Phone browsers can skip native pop-ups. Destructive actions (starting over, Bill cancel karo) show the app's own dialog with "Nahi" and a clear "Haan, …" button. Ask only when something would actually be lost.
10. **Never lose a bill.** The draft lives in `localStorage` on the phone (per user, 12-hour expiry), never on the server. Tab switches, refresh, Back, the OS killing the browser and an expired login must all bring the bill back.
11. **Values chosen for an amount are cleared when the amount changes.** Changing items clears final price, split and payment mode; removing the last item resets the whole bill.
12. **Nothing fails silently.** Every load shows a visible Hinglish error with a retry (`LoadError`), never an empty list that looks like "no data".
13. **Search and filters:** one clear (✕) button that also restores the normal list; filters collapsed by default and applied as soon as they change.
14. **Optional means optional.** Customer mobile/name, note, split are never required; if entered, they must be valid.

---

## 5. Money and data rules (non-negotiable)

A wrong number destroys trust in the app. Every rule here has a regression test; keep it that way.

- **The server is the source of truth for money.** It recomputes subtotal, discount, total and checks that payments add up exactly (±₹0.01). Never trust client totals.
- **`discount_amount` is authoritative** (including 0); `discount_percent` is derived from it.
- **Every cash event updates `app_state.cash_drawer` in the same transaction** as the operation, rounded to 2 decimals. Backdated bills never touch the drawer -- not when saved, cancelled or corrected.
- **Saved bills are never changed in place or hard-deleted.** Cancel = soft delete (`deleted_at`). Correction = Edit Bill (called "Bill badlo" in older notes): cancel + reissue in one transaction, linked by `replaces_bill_id`, keeping the original date and salesman; the drawer moves by the cash difference only.
- **A bill with an active return can't be cancelled or corrected** until the return is cancelled.
- **Returns** are matched to the exact sale line (`orig_bill_item_id`), refunded at the share actually paid (after bill discount and round-off), capped at what was paid, **Cash or UPI only -- never Card**, credited to the original bill's salesman. Salesmen: 7 days; admin: any age.
- **Idempotency:** every money-changing POST (bills, returns, cash-out) carries a `client_request_id` (UNIQUE). A repeat returns the existing record. The client makes a new id when the bill changes, and reuses it on a plain retry.
- **Sanity limits** (`src/lib/limits.js`, enforced on client and server): MRP ≤ ₹25,000 per piece, quantity ≤ 100 per line; ≤ 100 items and ≤ 3 payments per bill; notes ≤ 500 chars.
- **`bill_payments.mode`** is cash/upi/card only; `mixed` exists only as the bill-level summary.
- **Users with any history** (bills, cash-outs, expenses, print jobs) are deactivated, never deleted.
- **Reporting:** returns are not bills (counts and Avg Bill use sale bills); net revenue = sales − returns; Dashboard and Earnings must agree for the same period; category totals must add up to net revenue; item counts are net of returns; money displays as `₹1,23,456` / `-₹999`.
- **Salesmen see sales figures for today only** (enforced on the server). Bill Book records are any date for everyone.
- **Time is IST**, stored as TEXT. Use `src/lib/date-utils.js`; never format IST dates with `getUTC*` on a shifted Date.

---

## 6. Security and credentials

- **Never commit or print credentials.** No passwords, PINs or tokens in the repo, docs, commit messages or chat.
- **The owner sets the production admin password and salesman PINs** through the app. Nobody else chooses them.
- **AI agents never type credentials into login forms.** For local testing, sign a short-lived JWT with the local `.env.local` secret and put it in `localStorage`. Never do this against production.
- **Salesman PINs stay visible on the admin screen** (owner decision). Don't hash them.
- **`PRINT_AGENT_TOKEN` is rotated in Railway and the shop PC's `config.ini` at the same moment**, or printing stops.
- **Never run `seed.js` against production or on Railway** (it refuses, keep it that way). Production must never auto-create default logins.
- Every admin-only route checks `requireAdmin` (or `requireAdminOrAgent`) on the server; hiding a button is not security.
- Escape user text in every receipt/HTML path; strip control characters for ESC/POS; escape CSV formula characters.
- Keep the CSP strict: no third-party scripts, images or API calls from the browser.

---

## 7. Engineering conventions

### Stack and style
- JavaScript only (no TypeScript), React function components, Tailwind (no CSS files beyond `globals.css`).
- **No new dependencies without a strong reason.** Tests use Node's built-in `node:test`; there is no test framework dependency.
- Match the surrounding code: naming, comment density, Hinglish copy style.
- Shared helpers live in `src/lib/` (`date-utils`, `ui-utils`, `phone`, `limits`, `api-client`). Don't duplicate them in components.

### API routes
- Every route exports `export const dynamic = 'force-dynamic'`.
- Parse JSON defensively: `await request.json().catch(() => null)` → 400 "Request data galat hai".
- Validate everything first, then write everything in **one `db.transaction()`**. A validation failure must leave nothing half-written.
- Return Hinglish error messages with correct status codes (400 bad input, 403 not allowed, 404 missing, 409 conflict).
- Frontend calls go through `src/lib/api-client.js` (timeouts, request ids, 401 handling).

### Database and migrations
- `src/lib/db/index.js` is the **only** schema definition (`SCHEMA_SQL` + `MIGRATIONS`). `schema.sql` is retired -- don't add it back.
- Migrations are **append-only and numbered**. Never edit or reorder an existing one; every one still runs on old databases. One concern per migration.
- Use `addColumnIfMissing` (PRAGMA check), never a `try {} catch {}` around `ALTER`.
- **Before deploying, run new migrations on a copy of the production database** (download via `/api/backup`). Legacy prod tables have columns in a different order than fresh ones.
- Current version: 12. Project 2 (inventory) starts at 13.

### Testing
- **`npm test` must pass before every commit.** It starts `next dev` on a throwaway DB and runs `tests/*.test.mjs`.
- **Every money bug gets a regression test that fails before the fix.**
- **`tests/integrity.test.mjs` is the money safety net**: a seeded random mix of sales, returns, cancels, edits, backdated bills and cash-outs, checked against an independent model, the money audit, the drawer and every report. Any change to billing, returns, cancelling, the drawer or a report must keep it green (try several seeds: `SEED=11 OPS=400 node tests/run.mjs integrity`).
- **Every report must agree**: Dashboard, Earnings, Hisaab, customers and the CSV export (whose Total column must sum to net turnover, with returns negative).
- **Run `npm run audit <db-file>` on a copy of the production database** before every deploy and before every quarterly GST filing.
- **Verify UI changes in a real browser at phone width (≈420 px)** as the relevant role(s): keyboard behaviour, scroll, tap targets, the actual flow end to end. Also run `NEXT_DIST_DIR=.next-prodcheck npx next build` to confirm a clean production build.
- For phone testing on the same Wi-Fi: `npm run dev -- -H 0.0.0.0`, then open `http://<ipconfig getifaddr en0>:3000`.
- Work in dev mode (`npm run dev`, `data/masterji_dev.db`). Never point tests or experiments at production.

### Print agent (`print-agent/`)
- Python 3.8 on Windows 7 -- no newer syntax or libraries. `requests` and `pywin32==228` only.
- Receipt changes go in **both** `agent.py` (ESC/POS + HTML) and `src/lib/print-receipt.js` (browser), kept identical in content.
- Changes reach the shop PC when someone runs `update.bat` there.

---

## 8. Git workflow

- **All work happens on a feature branch.** Commit to `main` only when the owner confirms a final build; Railway deploys from `main`.
- Small, descriptive commits; don't commit `.DS_Store`, build folders, `data/` or `config.ini`.
- Before merging to `main`: tests green, clean build, prod DB backed up, migrations tested on a prod copy, `CHANGELIST.md` updated.

---

## 9. Keeping docs current

When behaviour changes, update in the same commit:
- `.ai/PROJECT_OVERVIEW.md` -- what the app does and how it's built
- `.ai/APP_RULES.md` -- a new rule or decision
- `CHANGELIST.md` -- what changed and how to test it
- `README.md` -- setup, API table, feature list

---

## 10. What NOT to do

- Don't add features, screens or flows that weren't asked for.
- Don't redesign screens that work, or reword familiar labels.
- Don't over-translate into Hindi, and don't write English-only jargon for casual phrases.
- Don't pre-select a payment mode or a category.
- Don't `autoFocus` on load.
- Don't use `window.confirm` / `alert` for new confirmations -- use the in-app dialog.
- Don't keep bill drafts on the server.
- Don't edit a saved bill in place or hard-delete money records.
- Don't refund to Card.
- Don't trust client-side totals on the server.
- Don't install dependencies casually.
- Don't touch the production database, run the seed script against it, or type credentials anywhere.
- Don't edit old migrations.
- Don't commit straight to `main`.

---

## 11. Deferred features (don't build unless asked)

Analysed in `DEFERRED_FEATURES.md`: WhatsApp bill sharing, employee attendance, period-comparison UI enhancements. **Inventory / barcode / tag printing is Project 2** (see the overview, section 11) and starts only when the owner says so.
