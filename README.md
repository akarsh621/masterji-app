# Master Ji Fashion House -- Billing & Analytics App

Internal billing and sales analytics application for **Master Ji Fashion House**, a clothing retail showroom in **Shastri Nagar, Ghaziabad, Uttar Pradesh, India**.

## Purpose

The shop runs a small-scale operation (3 salesmen, mostly walk-in customers) dealing primarily in women's, kids', and men's daily/everyday wear (kurtis, tops, t-shirts, shirts, pants, jeans, etc.). Previously all operations were paper-based with no structured bookkeeping, inventory tracking, or data visibility.

This app provides:

- **Digital bill creation** with itemized MRP + discount entries, tappable editable prices, and split/mixed payment modes
- **Per-salesman sales tracking** via individual PIN-based logins, with on-bill salesman selector
- **Real-time dashboard** with daily/weekly/monthly/custom analytics, category breakdowns (Ladies/Gents/Kids groups), salesman performance, daily and weekly trend charts, and period-over-period comparison
- **Expense tracking & monthly P&L** (admin-only Earnings tab) -- enter stock purchases, salaries, utilities, other expenses per month; see revenue vs expenses, net profit, profit margin, and month-over-month comparison
- **Returns/exchanges** with per-item return quantities and refund mode tracking
- **Persistent cash drawer tracking** (Hisaab) -- every cash event updates the drawer balance in real-time; admin can manually correct if physical count differs; petty cash target tracking; daily sweep for end-of-day cash collection
- **Print queue** for bill receipts -- "Print Bill" button queues to print agent; fallback browser print available
- **Sales history (Bill Book)** with filtering by date, salesman, payment mode, and CSV export (compact items column)
- **Cash auto-rounding** on cash-only payments (floor to nearest 10)
- **UPI as default payment mode** (reflecting common payment patterns)
- **Admin panel** for managing salesmen, categories, and admin users

The goal is to replace gut-feel decisions with data-driven ones: know what sells, who sells it, when it sells, and where discounts eat into margins.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Frontend | React 18, Tailwind CSS |
| Backend | Next.js API Routes (server-side) |
| Database | SQLite via `better-sqlite3` (file: `data/masterji.db`) |
| Auth | JWT (24h expiry), bcryptjs for password hashing |
| Language | JavaScript (no TypeScript) |
| Migrations | Numbered migration system via `schema_version` in `app_state` |

## Project Structure

```
app/
├── data/                        # SQLite database files (runtime, gitignored)
├── print-agent/                 # Python print agent for local receipt printing
├── public/
│   └── manifest.json            # PWA manifest
├── src/
│   ├── app/
│   │   ├── api/                 # All API routes (see API section below)
│   │   │   ├── auth/            # login, me, salesmen
│   │   │   ├── bills/           # CRUD + return
│   │   │   ├── cash-drawer/     # drawer balance + petty cash
│   │   │   ├── cash-out/        # cash-out recording (sweep, manual, expense, etc.)
│   │   │   ├── categories/      # CRUD
│   │   │   ├── dashboard/       # analytics aggregation
│   │   │   ├── earnings/        # monthly P&L (revenue + expenses)
│   │   │   ├── expenses/        # expense CRUD + labels autocomplete + copy
│   │   │   ├── export/          # CSV download
│   │   │   ├── hisaab/          # daily reconciliation summary
│   │   │   ├── print-queue/     # print job management
│   │   │   └── users/           # user management
│   │   ├── globals.css          # Tailwind base styles + custom utilities
│   │   ├── layout.js            # Root layout, AuthProvider, metadata
│   │   └── page.js              # Entry: LoginPage or AppShell based on auth
│   ├── components/
│   │   ├── AppShell.js          # Tab navigation (admin vs salesman views)
│   │   ├── BillPreview.js       # Bill item display (shared across screens)
│   │   ├── CashOutForm.js       # Cash-out form (reusable)
│   │   ├── CategoryBreakdown.js # Ladies/Gents/Kids category breakdown (reusable)
│   │   ├── Dashboard.js         # Admin analytics dashboard with trends + export
│   │   ├── DayClose.js          # Daily cash reconciliation (Hisaab) with sweep + petty cash
│   │   ├── DeltaBadge.js        # Period-over-period comparison badge (reusable)
│   │   ├── Earnings.js          # Admin expense tracking & monthly P&L
│   │   ├── LoginPage.js         # PIN login (salesmen) / password login (admin)
│   │   ├── NewBill.js           # Multi-step bill creation with salesman selector
│   │   ├── SalesHistory.js      # Bill listing with filters, returns, void + re-create
│   │   ├── Settings.js          # Admin CRUD for salesmen, categories, admins
│   │   └── TodaySummary.js      # Salesman's today-at-a-glance view
│   ├── context/
│   │   └── auth.js              # AuthProvider + useAuth hook (JWT in localStorage)
│   └── lib/
│       ├── api-client.js        # Frontend fetch wrapper with auth headers
│       ├── auth.js              # JWT sign/verify, requireAuth/requireAdmin middleware
│       ├── bill-data.js         # Bill normalization utilities
│       ├── print-receipt.js     # Browser-based receipt printing with shop branding + QR
│       ├── ui-utils.js          # Shared constants (reason labels, group labels/colors)
│       └── db/
│           ├── index.js         # SQLite connection singleton, migrations, auto-seed
│           ├── schema.sql       # Database schema (CREATE TABLE statements)
│           └── seed.js          # Seed script: creates DB, inserts default users + categories
├── .ai/
│   └── APP_RULES.md             # Development rulebook (UX philosophy, data integrity)
├── next.config.js               # better-sqlite3 externalized for server
├── tailwind.config.js           # Content paths, brand color palette
├── package.json                 # Dependencies and scripts
└── .env.local                   # JWT_SECRET (not committed)
```

## Database Schema

Nine tables, all timestamps in IST (UTC+5:30 via SQLite offset). Migrations managed via `schema_version` in `app_state`.

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Display name |
| role | TEXT | `admin` or `salesman` |
| username | TEXT | Admin only, unique |
| password_hash | TEXT | Admin only, bcrypt |
| pin | TEXT | Salesman only, 4 digits |
| active | INTEGER | 1 = active, 0 = deactivated |

### `categories`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | e.g. "Kurti", "T-Shirt" |
| group_name | TEXT | `women`, `men`, `kids`, or `other` |
| active | INTEGER | Soft toggle |
| display_order | INTEGER | Sort order within group |

### `bills`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| bill_number | TEXT | Format: `MJF-XXXX` (unique, sequential) |
| type | TEXT | `sale` (default) or `return` |
| original_bill_id | INTEGER FK | Links return bills to the original sale |
| subtotal | REAL | Sum of all item amounts |
| mrp_total | REAL | Sum of all item MRPs (MRP x quantity) |
| discount_percent | REAL | 0-100, always stored as percentage |
| discount_amount | REAL | Total discount from MRP (includes item-level + bill-level + cash round-off) |
| total | REAL | Final amount after all discounts |
| payment_mode | TEXT | `cash`, `upi`, `card`, or `mixed` |
| salesman_id | INTEGER FK | Who created the bill |
| notes | TEXT | Optional free text |
| deleted_at | DATETIME | Soft delete timestamp (NULL = active) |

### `bill_items`
| Column | Type | Notes |
|--------|------|-------|
| bill_id | INTEGER FK | CASCADE delete with parent bill |
| category_id | INTEGER FK | Which product category |
| mrp | REAL | MRP (tag price) per piece |
| quantity | INTEGER | Number of pieces (> 0) |
| amount | REAL | Selling price x quantity (after item-level discount) |
| cost_price | REAL | Reserved for future cost tracking (nullable) |

### `bill_payments`
| Column | Type | Notes |
|--------|------|-------|
| bill_id | INTEGER FK | CASCADE delete with parent bill |
| mode | TEXT | `cash`, `upi`, or `card` |
| amount | REAL | Amount paid via this mode (> 0) |

Split payments store multiple rows per bill. Single payments store one row.

### `cash_out`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| amount | REAL | How much cash left the drawer |
| reason | TEXT | `expense`, `supplier`, `owner`, `other`, `sweep`, or `manual` |
| note | TEXT | Optional description (mandatory for `manual`) |
| recorded_by | INTEGER FK | Who recorded this entry |

### `app_state`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Always `1` (single-row table) |
| cash_drawer | REAL | Persistent cash-in-drawer balance |
| petty_cash_target | REAL | Petty cash to leave in drawer after daily sweep (default ₹1,000) |
| schema_version | INTEGER | Tracks applied migrations |

### `print_queue`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| bill_id | INTEGER FK | Which bill to print |
| status | TEXT | `pending`, `printing`, `printed`, or `failed` |
| requested_by | INTEGER FK | Who requested the print |
| printed_at | DATETIME | When print completed |

### `expenses`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| category | TEXT | `stock_purchase`, `salaries`, `shop_utilities`, or `other` |
| amount | REAL | Expense amount (positive) |
| label | TEXT | Supplier name (stock) or person name (salary); null for utilities/other |
| note | TEXT | Optional description |
| expense_month | TEXT | Month this belongs to (`YYYY-MM`) |
| expense_date | TEXT | Specific date for dated entries (`YYYY-MM-DD`); null for undated |
| recorded_by | INTEGER FK | Admin who entered it |

## API Routes

All routes are under `/api/`. Auth is via `Authorization: Bearer <JWT>` header.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | Public | Login (admin: username+password, salesman: id+pin) |
| GET | `/api/auth/me` | Bearer | Current user info + DB mode |
| GET | `/api/auth/salesmen` | Public | List active salesmen names (for login screen + selectors) |
| POST | `/api/bills` | Bearer | Create bill with items + payments array |
| GET | `/api/bills` | Bearer | List bills (paginated, filtered) -- all-store data for all users |
| DELETE | `/api/bills/:id` | Bearer | Soft-delete (admin: any time; salesman: own bills within 15 min) |
| POST | `/api/bills/:id/return` | Admin | Create return bill against an existing sale |
| GET | `/api/categories` | Bearer | List categories (grouped). `?all=true` includes inactive. |
| POST | `/api/categories` | Admin | Add new category |
| PATCH | `/api/categories/:id` | Admin | Update category name/group/active |
| GET | `/api/dashboard` | Bearer | Analytics. `?view=today\|week\|month` or `?from=&to=`. All-store data. |
| GET | `/api/export` | Admin | CSV download. Optional `?from=&to=`. Compact items column. |
| GET | `/api/hisaab` | Bearer | Daily reconciliation: drawer balance, petty cash, today's cash flow |
| GET | `/api/cash-drawer` | Bearer | Current cash drawer + petty cash target |
| PUT | `/api/cash-drawer` | Admin | Manually correct drawer balance |
| PATCH | `/api/cash-drawer` | Admin | Update petty cash target |
| POST | `/api/cash-out` | Bearer | Record cash leaving the drawer (auto-updates drawer) |
| GET | `/api/cash-out` | Bearer | List cash-out entries. `?from=&to=` for date filtering. |
| GET | `/api/earnings` | Admin | Monthly P&L (revenue from bills + expense totals + computed metrics + previous month delta) |
| GET | `/api/expenses` | Admin | List expenses for `?month=YYYY-MM` with category totals |
| POST | `/api/expenses` | Admin | Create expense entry |
| PATCH | `/api/expenses/:id` | Admin | Update expense (amount, label, note, date) |
| DELETE | `/api/expenses/:id` | Admin | Delete expense entry |
| GET | `/api/expenses/labels` | Admin | Autocomplete: last 10 unique labels for `?category=` |
| POST | `/api/expenses/copy` | Admin | Copy all expenses from one month to another |
| POST | `/api/print-queue` | Bearer | Queue a bill for printing |
| GET | `/api/print-queue` | Bearer/Agent | Fetch pending print jobs |
| PATCH | `/api/print-queue/:id` | Bearer/Agent | Update print job status |
| GET | `/api/users` | Admin | List all users |
| POST | `/api/users` | Admin | Create admin or salesman |
| PATCH | `/api/users/:id` | Admin | Update name/pin/active |
| DELETE | `/api/users/:id` | Admin | Delete user (deactivates if bills exist) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
cd app

# Install dependencies
npm install

# Seed the database (creates data/masterji.db with default users and categories)
npm run seed

# Start development server (uses dev database)
npm run dev

# Or start with production database
npm run prod
```

The app runs at **http://localhost:3000**.

### Dev vs Prod Database

Two separate SQLite files so testing/demoing never touches real data:

| | Prod | Dev |
|--|------|-----|
| DB file | `data/masterji.db` | `data/masterji_dev.db` |
| Seed | `npm run seed` | `npm run seed:dev` |
| Start server | `npm run prod` | `npm run dev` |
| Env var | `DB_MODE` not set (default) | `DB_MODE=dev` (set by script) |
| UI indicator | None | Amber "DEV MODE" banner at top |

Both databases are fully independent. You can seed dev repeatedly without affecting prod. Migrations run automatically on server start via `schema_version` tracking.

### Default Credentials

| Role | Login | Credential |
|------|-------|------------|
| Admin | Username: `admin` | Password: `admin123` |
| Salesman 1 | Select name on login screen | PIN: `1111` |
| Salesman 2 | Select name on login screen | PIN: `2222` |
| Salesman 3 | Select name on login screen | PIN: `3333` |

Admin username, password, and name can be changed from **Settings > Admin > Edit**. Salesman names and PINs can be changed from **Settings > Sales Team > Edit**.

### Accessing from Phone (Local Network)

1. Find your computer's local IP (e.g. `192.168.1.x`)
2. Open `http://192.168.1.x:3000` on the phone browser
3. Use "Add to Home Screen" for a PWA-like experience

### Deployment (Railway)

The app is deployed to Railway with a persistent volume for the SQLite database. Auto-seed runs on first start. See Railway dashboard for volume and environment variable configuration.

## Admin Navigation

Admin has 5 bottom tabs + Settings in the header:

| Tab | Purpose |
|-----|---------|
| **Naya Bill** | Create new bills (default tab) |
| **Dashboard** | Analytics: Aaj/Hafta/Mahina/Custom with trends, category breakdown, salesman performance, export |
| **Earnings** | Monthly P&L: revenue vs expenses, profit margin, expense management |
| **Hisaab** | Cash drawer balance, petty cash, daily sweep, manual cash-out |
| **Bill Book** | Bill history with search, filter, void, return, print |
| **⚙ Settings** (header) | Manage salesmen, categories, admin users |

Salesmen have 3 tabs: **Naya Bill**, **Aaj** (today summary), **Bill Book**.

## UI Language

The app UI is in **Hinglish** (Hindi in Roman script) -- designed for non-tech-savvy salesmen in the shop. Examples: "Naya Bill Banao", "Category chuno", "Bill Save Karo".

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| SQLite (not Postgres/MySQL) | Single-file DB, zero setup, perfect for local single-shop deployment |
| PIN login for salesmen | Speed -- no typing usernames, just tap name + 4 digits |
| UPI as default payment mode | Reflects real-world usage patterns at the shop |
| MRP + Discount % input model | Matches how shop negotiation works: start from tag price, offer discount |
| Tappable editable prices in item list | Salesmen can adjust final selling price after adding; discount recalculates |
| Cash auto-rounding (floor to nearest 10) | Common retail practice; subtle "₹X round off" indicator shown |
| Split payments via `bill_payments` table | Captures exact cash/UPI/card split per bill for accurate drawer reconciliation |
| Discount stored as percentage | Consistent analytics even when discount is entered as a final price |
| Soft delete for bills | Preserve historical data integrity; deleted bills excluded from analytics |
| On-bill salesman selector | Any user can reassign a bill to a different salesman before saving |
| All-store data for salesmen | Aaj and Bill Book tabs show all-store data (not just own) for cross-verification |
| Category-first billing flow | Prevents wrong-category mistakes; no auto-select on load, no auto-keyboard |
| Persistent cash drawer (not daily calculation) | Single `app_state.cash_drawer` value updated atomically by every cash event |
| Petty cash + daily sweep | Separates sale cash collection from operational petty cash left in drawer |
| Expenses separate from cash drawer | Cash drawer = daily operational flow; Expenses = business-level P&L (monthly) |
| Numbered DB migrations | `schema_version` in `app_state` + `MIGRATIONS` array ensures safe incremental upgrades |
| Bill number format `MJF-XXXX` | Human-readable, sequential, internal-only |
| IST timestamps via SQLite offset | No timezone library needed; all users are in one timezone |
| JWT in localStorage | Simple SPA auth; acceptable for internal-only tool on local network |
| No inventory/stock tracking (yet) | MVP focuses on sales data capture; stock is a future phase |

## Related Documents

- [`CHANGELIST.md`](./CHANGELIST.md) -- Changelog with test instructions for QA
- [`DEFERRED_FEATURES.md`](./DEFERRED_FEATURES.md) -- Features analyzed but postponed
- [`.ai/APP_RULES.md`](./.ai/APP_RULES.md) -- Development rulebook (UX philosophy, data integrity, conventions)
- [`docs/prd-expense-tracking-pnl.md`](../docs/prd-expense-tracking-pnl.md) -- PRD for expense tracking feature
- [`docs/clearance-sale-strategy-guide.md`](../docs/clearance-sale-strategy-guide.md) -- Hinglish guide for clearance sales
