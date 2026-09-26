# Master Ji Fashion House -- Decision Log

Every decision the owner has taken about how the app should behave, and **why**. Before changing anything listed here, ask the owner -- most of these exist for tax, money or shop-floor reasons that aren't visible in the code.

**Add a row whenever the owner decides something new** (in the same commit as the change). Newest decisions are marked with their date; "Sep 2026" = decided during Project 1.

---

## 1. Tax and compliance (GST composition scheme)

The shop is registered under the **GST composition scheme**. The app's figures are used for the **quarterly CMP-08 filing**, so a wrong or changed number is a legal risk, not just a reporting bug.

| Decision | Why | When |
|---|---|---|
| **Bills in a closed quarter can't be cancelled or edited**, and nothing can be backdated into one. A quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar) locks on the **11th of the month after it ends** (e.g. Apr–Jun locks on 11 July). Returns still work. | Figures already filed in CMP-08 must never change. The 10 days give time to fix mistakes before filing (CMP-08 is due on the 18th). | 27 Sep 2026 |
| A return is dated **the day it happens**, even for an old bill, and counts in that day's quarter. | That's when the refund (credit) actually happens; old quarters stay as filed. | Sep 2026 |
| **Turnover = active sales − active returns, by bill date.** Cancelled bills (and the old side of an edited bill) don't count. | One definition everywhere: Dashboard, Earnings, CSV export, `npm run audit`. | Sep 2026 |
| **CSV export shows returns as negative** (Total, Subtotal, MRP, Discount, pieces, payments) with an "Against Bill" column. | Summing the Total column in a spreadsheet must give true net turnover. Before, returns were positive and a plain sum overstated turnover (i.e. more tax). | 27 Sep 2026 |
| Run **`npm run audit`** on a copy of the production DB before every deploy and every quarterly filing; use its quarter figure. | Independent check of every bill; prints turnover by GST quarter. | 27 Sep 2026 |
| **No GST invoicing.** The receipt is a **Bill of Supply**: heading and "Composition taxable person, not eligible to collect tax on supplies" at the **top**, GSTIN under the address, "For MASTER JI FASHION HOUSE / Authorised Signatory". | Required for a composition dealer (declaration at the top, supplier signature). | Sep 2026 |
| **GSTIN is a placeholder** (`SHOP_GSTIN = ''` in `print-agent/agent.py` and `src/lib/print-receipt.js`) until the owner provides it. | Owner to supply. | 26 Sep 2026 |
| **Bill numbers stay `MJF-XXXX`** (one running series). No financial-year series like `MJF/26-27/0231`. | Already legally fine (unique, under 16 characters); changing it would touch the whole app. | 26 Sep 2026 |
| **No separate Round Off line.** Discount on the receipt = everything off MRP (item discounts, final price, cash round-off). | The app stores round-off inside the discount; no schema change for a cosmetic line. | 26 Sep 2026 |
| No composition-limit tracker (₹1.5 crore) and no financial-year total. | Owner reads turnover off the reports; reconfirmed. | Sep 2026, reconfirmed 27 Sep 2026 |
| **Quarter turnover lives in Dashboard → Custom** as one **Quarter (GST)** dropdown, grouped by financial year, listing quarters from the first bill to the running one ("chalu", up to today). Picking one fills the dates; a line shows "Turnover = Net Revenue", the lock date and CMP-08 due date, or "Band ✓". A whole quarter compares with the whole previous quarter. Export gives the CA that quarter's bills. Quarters only (no full-year option for now); not added to Earnings, which stays monthly. | One place for the filing figure and the CA's file; no clutter (one dropdown, not four buttons); the list builds itself across years. | 27 Sep 2026 |

## 2. Money rules

| Decision | Why | When |
|---|---|---|
| **A saved bill is never changed in place.** Corrections are **Edit Bill** = cancel + reissue in one step, linked both ways, keeping the original date and salesman. (Called "Bill badlo" until 27 Sep 2026.) | The printed receipt, the drawer and the tax figures must match what was saved. | Sep 2026 |
| Edit Bill moves the drawer only by the **cash difference**, and never for backdated bills. | ₹960 cash corrected to ₹900 cash is −₹60, not −₹960 then +₹900. | Sep 2026 |
| **Salesmen** can cancel or edit only **their own bill within 15 minutes**; admin any bill (except closed quarters). | Mistakes are caught at the counter; later changes need the owner. | Sep 2026 |
| A sale **with an active return can't be cancelled or edited** until the return is cancelled. | Otherwise the refund stays counted against a bill that no longer exists. | Sep 2026 |
| **Returns**: salesmen up to **7 days**, admin any age. | Matches "Exchange / Return sirf 7 din mein" on the receipt. | Sep 2026 |
| Refund = **what the customer actually paid** for those pieces (share after bill discount and round-off); never more than the bill total. | Refunds at pre-discount prices were paying out more than was received. | Sep 2026 |
| **Refunds are Cash (default) or UPI, never Card.** | The shop can't refund to a card. | Sep 2026 |
| A return is credited to the **original bill's salesman**; old returns were re-credited (migration v12). | One salesman's return shouldn't reduce another's sales. | Sep 2026 |
| **No exchange flow.** The button is "Return"; an exchange is a return plus a new bill. | Exchanges are rare; one flow is simpler. | Sep 2026 |
| **Backdated bills**: admin only, up to 30 days, never touch the cash drawer. | They were already reconciled on paper that day. | Sep 2026 |
| **No default payment mode.** The salesman must tap Cash / UPI / Card; Save shows "Payment mode chuno". | A pre-selected mode let forgotten taps record cash as UPI and break Hisaab. | Sep 2026 |
| **Changing items clears final price, split and payment mode**; removing the last item resets the whole bill. | They were chosen for the old amount; an old final price once silently discounted new items. | 25 Sep 2026 |
| Cash-only bills **round down to the nearest ₹10**. | Existing shop practice. | MVP |
| **MRP ≤ ₹25,000 per piece, qty ≤ 100 per line** (phone and server). | A typing slip (₹1.8 crore item) was accepted. | 25 Sep 2026 |
| **Returns are not bills**: bill counts and Avg Bill use sale bills only; Dashboard and Earnings must agree. | Returns were lowering Avg Bill and inflating counts. | Sep 2026 |
| **Cash-out is admin-only** (server-enforced). | Only the owner takes money out of the drawer. | Sep 2026 |
| Every money-changing save carries a request id, so a retry never records twice. | Bad shop 4G caused duplicate bills. | Sep 2026 |

## 3. Who sees and does what

| Decision | Why | When |
|---|---|---|
| Salesmen see **sales figures for today only** (Aaj); **Bill Book for any date**. | Bills are records they need; analytics are the owner's. | Sep 2026 |
| Anyone can **credit a bill to another salesman** ("Sale by"). | Shop practice; unchanged. | MVP |
| **Salesman PINs stay visible** on the admin screen; not hashed. | Convenience for the owner outweighs hashing here. | Sep 2026 |
| **The owner sets the admin password and all PINs**; nobody else chooses them. AI agents never type credentials. | Security. | Sep 2026 |
| Customers are **optional** (mobile + name). **A phone number is a household**; each bill keeps the name as typed. Internal use only, no automated messages. | Families share a phone; builds a customer list without slowing billing. | Sep 2026 |
| Customer list lives in **Settings → Customers** (admin). | Bottom bar is full on a phone. | Sep 2026 |

## 4. Billing screen and UI

| Decision | Why | When |
|---|---|---|
| **Fix what's broken; don't redesign what works.** Only owner-requested screen changes. | Non-technical users; familiarity matters more than polish. | Sep 2026 |
| **Balanced Hinglish**: English for technical/common terms, Hinglish for casual phrases. | Over-translation reads as costume and confuses. | Sep 2026 |
| **Drafts live on the phone** (localStorage, per user, 12 h), never on the server. | Works when the internet drops; no half-bills in the database. | Sep 2026 |
| **Final Price**: tap the Total, one-tap round-down amounts, one "₹X se ₹Y kam kiya" line. | The old panel repeated the same numbers four times. | Sep 2026 |
| **Hatao** is plain red text (no box). | The boxed version was too loud and added space. | 25 Sep 2026 |
| **Bill cancel karo only on the payment screen**; the bottom **Naya Bill** tab starts a new bill (asks first). | Fewer buttons on the items screen. | 26 Sep 2026 |
| Confirmations use the **in-app box**, not browser pop-ups. | Phone browsers can skip `window.confirm`. | 26 Sep 2026 |
| Bill Book actions: **Print Bill · Return · Edit Bill · Cancel Bill** as one row of pills. Edit screen: "Bill MJF-XXXX edit kar rahe ho" / "Cancel editing". | Cancel shouldn't be the loudest button; "Bill badlo" wasn't clear. | 27 Sep 2026 |
| Bill Book: filters collapsed by default, apply on change; one ✕ that restores the list. | Search first; the old ✕ left stale results. | 25 Sep 2026 |
| **UPI QR removed.** | Never used; payments are verified on the POS machines. | Sep 2026 |
| Receipt: item lines show **MRP × qty (no Rate column)**, MRP Total, Discount, TOTAL; a payment line on every bill; English thank-you lines; "Exchange / Return sirf 7 din mein" kept. | Owner's layout. | 26 Sep 2026 |
| Not done (owner declined): Hisaab redesign, return-panel redesign, pinned Save button, Earnings relabel, Logout move, PIN hashing. | Not necessary. | Sep 2026 |

## 5. Operations and development

| Decision | Why | When |
|---|---|---|
| All work on a **feature branch**; merge to `main` (= deploy) only when the owner confirms a final build. | Railway deploys from `main`. | Sep 2026 |
| Production **never auto-creates default logins**; refuses to start on an empty database. | A missing volume must stop the deploy, not open the shop with `admin123`. | Sep 2026 |
| **Daily database backup** pulled by the shop PC agent, 30 copies kept. | The only copy outside Railway. | Sep 2026 |
| **Repo to be made private**; print agent updates come from the Railway app. | Code and history were public. | Sep 2026 |
| `PRINT_AGENT_TOKEN` is rotated **at the shop-PC visit**, in Railway and `config.ini` together. | Changing only one side stops printing. | Sep 2026 |
| **Build, don't buy** (vs Vyapar/myBillBook). | Workflow fit, Hinglish, cash-drawer model and zero retraining. | Sep 2026 |
| **Inventory, barcode and tag printing = Project 2**, parked. Its decisions are in `.ai/PROJECT_OVERVIEW.md` §11. | Hardening first. | Sep 2026 |
