# Master Ji Fashion House -- App Development Rulebook

This document is the source of truth for any developer or AI agent working on this codebase. Read it before writing any code.

---

## Business Context

- **Shop**: Master Ji Fashion House, Shastri Nagar main market, Ghaziabad, Uttar Pradesh, India
- **What they sell**: Women's, kids', and men's daily/everyday clothing (kurtis, tops, palazzo, dupatta, shirts, t-shirts, pants, jeans, etc.)
- **Scale**: Small operation -- 3 salesmen, one shop, mostly walk-in customers
- **Previous system**: 100% paper-based. No digital anything. Bills written by hand, calculator for MRP-to-selling-price math, cash counted by eye at end of day.
- **Who runs it**: Owner (father) handles finances at a high level, mother is involved day-to-day, son (developer) works full-time elsewhere and built this app
- **Why this app exists**: Replace gut-feel with data. Track what sells, who sells it, when, how much discount is given, what payment modes are used. This is a simple **khata/galla book-keeping app** -- not a POS, not an ERP, not an inventory system. Sales data capture is the goal.
- **Stakes**: This is the family livelihood. Bad data is worse than no data because it leads to wrong decisions.

---

## The Users -- This Is the Most Important Section

**The salesmen are not technical people. They are not very literate. They use basic smartphones.**

Every single design decision flows from this fact:

- They don't read English comfortably -- that's why the UI is in **Hinglish** (Hindi written in Roman/Latin script)
- They don't explore UIs -- every action must be **obvious without training**
- They work fast during rush hours -- the app must **never slow them down** compared to paper
- They make mistakes under pressure -- the app must **prevent wrong-category entries** by design
- They don't understand technical concepts -- no "modes", no "toggles", no "settings". Just buttons that say what they do: "Hatao" (remove), "Bill Save Karo" (save bill), "Payment Karo" (go to payment)
- Mobile keyboard is their enemy -- it covers half the screen and hides context. **Never auto-open keyboard unless the user just tapped something that needs typing.**

---

## Why Hinglish (Not English, Not Hindi)

- Salesmen speak Hindi natively
- They read Roman script on their phones (WhatsApp, etc.) -- they're comfortable with it
- Pure English labels like "Submit", "Delete", "Discount Applied" would be confusing
- Pure Devanagari Hindi would be harder to read on small screens and harder to code
- Hinglish is the sweet spot: "Naya Bill Banao", "Hatao", "Bill Save Karo", "Aaj ka Summary", "Galat hai? Cancel karo"
- Keep it natural -- write labels the way a shopkeeper would say them out loud

---

## UX Philosophy

These rules were learned through real feedback from salesmen using the app. Follow them strictly.

### 1. Category-first billing flow
- On the billing screen, the salesman sees **only category pills and existing bill items** by default
- No input fields visible until a category is tapped
- Tapping a category highlights it, reveals the input section (MRP, Discount %, Qty, Add), and focuses MRP
- After adding an item, the input section **collapses** and category deselects -- salesman sees categories + bill again
- This prevents wrong-category mistakes when salesmen are in a hurry

### 2. No autofocus on page load
- Mobile keyboards cover the screen and hide context (categories, bill items)
- `autoFocus` is only allowed after an explicit user action (e.g., tapping a category, opening a discount section)
- Never on component mount or page load

### 3. The app replaces their calculator
- Salesmen used to: look at MRP tag, decide discount %, punch into calculator, write selling price
- Now they enter MRP + Discount % and the app shows `₹1200 - 20% = ₹960` live
- This is a core value proposition -- don't remove or hide the live calculation

### 4. Final price always visible and bold
- Every item in the bill list shows the selling amount on the right side, large and bold
- The salesman and customer can both glance at it during haggling

### 5. Paper bill feel on payment screen
- The payment screen shows a "Bill Preview" that looks like the paper bills they're used to
- Item-by-item with MRP, discount, selling price -- all visible for customer haggling
- MRP total, selling total, and discount amount shown clearly

### 6. Hide infrequent features behind buttons
- Split Payment, Note, Extra Discount -- these happen sometimes, not every bill
- They're hidden behind clearly-labeled buttons that expand when tapped
- Don't clutter the default view with rarely-used fields

### 7. Obvious button labels
- "Hatao" not "×" or "Delete"
- "Bill Save Karo" not "Submit"
- "Payment Karo" not "Proceed to Checkout"
- "Galat hai? Cancel karo" not "Void Bill"
- Every button should pass the test: "Would my salesman understand this without being told?"

### 8. Bold, large tap targets
- Buttons are full-width where possible
- Text is large enough to tap without precision
- Spacing is generous -- no accidental taps on adjacent elements

---

## Data Integrity Rules

Financial data accuracy is non-negotiable. A bug that miscalculates a bill amount will erode trust and kill adoption.

- All cash mutations (sale with cash, cash refund, bill void, cash-out) update `app_state.cash_drawer` inside the **same database transaction** as the primary operation
- `discount_amount` is authoritative (including 0); the stored `discount_percent` is derived from it so the two never disagree
- Bills are soft-deleted (timestamped), never hard-deleted -- historical data must survive
- Users with any history (bills, cash-outs, expenses, print jobs) are deactivated, not deleted -- referential integrity
- Backdated bills (`is_backdated = 1`) never touch the cash drawer -- not when saved, cancelled, or corrected
- A refund never exceeds what the customer paid for that line (after bill discount and round-off); refunds are Cash or UPI, never Card
- Returns are matched to the exact sale line (`orig_bill_item_id`) and credited to the original bill's salesman
- A saved bill is never edited in place. Corrections are Bill badlo: cancel + reissue in one transaction, old and new linked
- Every money-changing POST carries a `client_request_id`, so a retried request never records twice
- Returns are not bills: bill counts and Avg Bill use sale bills only, and Dashboard and Earnings must agree
- Individual payment entries in `bill_payments` only allow `cash`, `upi`, `card` -- never `mixed` (that's the bill-level aggregate mode)

---

## Development Guidelines

### Environment
- **Always work in dev mode** (`npm run dev`) unless explicitly told to touch prod
- Dev uses `data/masterji_dev.db`, prod uses `data/masterji.db` -- completely independent
- No backward compatibility concerns in dev phase -- schema changes are free
- `JWT_SECRET` must be set as environment variable (no hardcoded fallback)

### Code Style
- JavaScript only (no TypeScript) -- keep the stack simple
- Tailwind CSS for styling -- no custom CSS files beyond `globals.css`
- API routes in Next.js App Router (`app/api/`)
- All API routes that use `request.headers` must export `const dynamic = 'force-dynamic'` to prevent Next.js static rendering issues on Railway

### Testing
- `npm test` must pass before committing. Every money bug gets a regression test that fails before the fix
- Test on mobile viewport (420px width) -- that's the real usage environment
- After any UI change, verify: keyboard behavior, scroll position, tap target size
- After any API/DB change, verify: discount math, cash drawer updates, payment validation

### What NOT to do
- Don't add features not explicitly requested -- resist feature creep
- Don't over-translate: English for technical and common terms (Cash, MRP, Discount, Net Profit, Return), Hinglish only for casual phrases and short instructions
- Don't redesign screens that work -- fix what's broken, keep familiar layouts and wording
- Don't pre-select a payment mode
- Don't keep bill drafts on the server -- they live in `localStorage` on the phone
- Don't use `autoFocus` on page/component load
- Don't pre-select categories on billing screen load
- Don't use symbols where words work better (Hatao > ×, Cancel karo > Delete)
- Don't install new dependencies without a strong reason
- Don't touch prod database during development, and never run `seed.js` against it
- Don't add `schema.sql` back -- `src/lib/db/index.js` is the single schema definition

---

## Current App State

- **Phase**: MVP -- sales data capture and basic analytics
- **Deployed**: Railway (prod at masterji-app-production.up.railway.app) + local dev
- **Billing flow**: Two screens -- Item Building (MRP + Discount % input) -> Payment (bill preview + payment mode + submit)
- **Schema**: `bill_items` has `mrp` column for per-item MRP tracking
- **Auth**: PIN-based for salesmen, username/password for admin, JWT tokens
- **Cash tracking**: Persistent `cash_drawer` in `app_state`, updated atomically
- **Customers**: optional phone (one per household) + name typed on the bill; admin Customers screen
- **Safety net**: integration tests (`npm test`), nightly DB backup pulled by the print agent, login rate limiting

---

## Deferred Features (Do NOT Implement Unless Explicitly Asked)

These have been analyzed and documented in `DEFERRED_FEATURES.md`:

- WhatsApp bill sharing
- Employee attendance (in/out time)
- Stock/inventory tracking
- Period-over-period comparison UI enhancements
