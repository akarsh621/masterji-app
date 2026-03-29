# Deferred Features -- Master Ji Fashion House

Features analyzed and documented for future implementation. Not blocking for launch.

---

## 1. WhatsApp Bill Sharing

**What:** "Share on WhatsApp" button on the bill success screen after a bill is created.

**How it would work:**
- Use WhatsApp deep link: `https://wa.me/?text=...` (no API key, no backend changes)
- Formatted bill text includes: shop name, bill number, itemized list, total, date
- If customer phone is captured (see item 2), link becomes `https://wa.me/91XXXXXXXXXX?text=...` for direct send

**Example message:**
```
Master Ji Fashion House
Bill: MJF-0042
---
Kurti x2 - Rs 1600
Top x1 - Rs 400
---
Total: Rs 1800 (10% off)
Payment: Cash
Date: 20 Mar 2026

Thank you! Visit again.
```

**Value:**
- Professional image for the shop
- Passive phone number collection (customer gives number to receive bill)
- Over time, builds a broadcast list for clearance sale and new arrival announcements
- Zero cost -- uses existing WhatsApp on the salesman's phone

**Effort:** 1-2 hours. Frontend-only change (button + text formatting). No backend, no schema changes.

**Dependency:** Pairs well with customer phone field (item 2) but works standalone too.

**When to build:** After salesmen are comfortable with the billing flow (2-4 weeks of usage).

---

## 2. Customer Phone Number

**What:** Optional phone number field on bill creation.

**Schema change:**
```sql
ALTER TABLE bills ADD COLUMN customer_phone TEXT;
```

**UI change:** Single optional input in the "Bill Complete Karo" section, between payment mode and notes. Placeholder: "Customer ka number (optional)".

**What it unlocks:**
- **Repeat customer identification:** See how often a customer comes back, what they buy, avg spend
- **Purchase frequency analysis:** "50 customers came once, 12 came 3+ times this month"
- **Targeted outreach:** "Madam, aapke size mein naya stock aaya hai" via WhatsApp
- **Clearance sale marketing:** Direct WhatsApp blast to customers who bought similar items
- **Customer lifetime value:** Track which customers drive the most revenue

**Privacy considerations:**
- Field is optional -- never forced
- Internal use only -- no automated SMS or notifications
- No sharing with third parties
- Salesman should mention "bill WhatsApp pe bhej dein?" to get the number naturally

**Effort:** 1-2 hours. Schema migration (one column), one input field in NewBill, optional filter in SalesHistory, phone column in CSV export.

**When to build:** Alongside or immediately after WhatsApp bill sharing -- they create a natural workflow together.

---

## 3. Employee Attendance

**What:** Track salesman check-in and check-out times.

**Schema:**
```sql
CREATE TABLE attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    check_in DATETIME NOT NULL,
    check_out DATETIME,
    created_at DATETIME DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
    UNIQUE(user_id, date)
);
```

**UI flow:**
- **Check-in:** After salesman logs in, a prominent "Aa Gaya" button appears. Tap to record check-in time. Button disappears once tapped.
- **Check-out:** In the header or profile area, a "Ja Raha Hoon" button. Records check-out time.
- **Admin view:** New tab or section in Settings showing attendance log: date, salesman name, check-in time, check-out time, hours worked.

**Edge cases that need handling:**
- Missed check-out: Auto-close at midnight (mark as "auto-closed") or prompt next morning
- Multiple shifts: Allow multiple check-in/out per day if breaks are common. Alternatively, keep it simple with one in/out per day.
- App restart: If phone browser closes and salesman logs in again, detect existing check-in for the day (don't create duplicate)
- Timezone: Use IST consistently, same as bills

**What it unlocks:**
- Hours worked vs sales correlation: "Raju works 10 hours, sells Rs 15k. Vikram works 8 hours, sells Rs 18k." Efficiency visibility.
- Late arrival / early departure patterns
- Basic payroll support: total hours worked per month
- Accountability: presence tracking without CCTV

**Complexity:** Medium. The core feature (check-in/out + admin log) is straightforward. The edge cases (missed check-outs, multiple sessions) add complexity. Recommend keeping V1 simple: one check-in/check-out per day, auto-close at midnight.

**Effort:** 4-6 hours for V1. New table, two API endpoints, attendance component, admin log view.

**When to build:** After 1-2 months of app usage. The billing flow must be trusted and habitual before adding friction to the login experience. If salesmen feel the app is "tracking them" before they see its value for billing, adoption drops.

**Recommendation:** Start with the simplest version -- check-in on login, manual check-out. Don't block login on attendance. Don't add break tracking in V1. Get data for a month, then evaluate if more granularity is needed.
