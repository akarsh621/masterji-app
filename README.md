# Master Ji Fashion House -- Billing & Analytics App

Internal billing and sales analytics application for **Master Ji Fashion House**, a clothing retail showroom in **Shastri Nagar, Ghaziabad, Uttar Pradesh, India**.

## Purpose

The shop runs a small-scale operation (3 salesmen, mostly walk-in customers) dealing primarily in women's, kids', and men's daily/everyday wear (kurtis, tops, t-shirts, shirts, pants, jeans, etc.). Previously all operations were paper-based with no structured bookkeeping, inventory tracking, or data visibility.

This app provides:

- **Digital bill creation** with itemized entries, discount tracking, and split/mixed payment modes
- **Per-salesman sales tracking** via individual PIN-based logins
- **Real-time dashboard** with daily/weekly/monthly/custom analytics, category breakdowns, salesman performance, and period-over-period comparison
- **Returns/exchanges** with per-item return quantities and refund mode tracking
- **Persistent cash drawer tracking** (Hisaab) -- every cash event updates the drawer balance in real-time; admin can manually correct if physical count differs
- **Sales history** with filtering by date, salesman, payment mode, and CSV export
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

## Project Structure

```
app/
├── data/                        # SQLite database file (runtime, gitignored)
├── public/
│   └── manifest.json            # PWA manifest
├── src/
│   ├── app/
│   │   ├── api/                 # All API routes (see API section below)
│   │   ├── globals.css          # Tailwind base styles + custom utilities
│   │   ├── layout.js            # Root layout, AuthProvider, metadata
│   │   └── page.js              # Entry: LoginPage or AppShell based on auth
│   ├── components/
│   │   ├── AppShell.js          # Tab navigation (admin vs salesman views)
│   │   ├── Dashboard.js         # Admin analytics dashboard with custom dates + comparisons
│   │   ├── DayClose.js          # Daily cash reconciliation (Hisaab) with cash-out recording
│   │   ├── LoginPage.js         # PIN login (salesmen) / password login (admin)
│   │   ├── NewBill.js           # Multi-step bill creation with split payments + discount
│   │   ├── SalesHistory.js      # Bill listing with filters, returns, void + re-create
│   │   ├── Settings.js          # Admin CRUD for salesmen, categories, admins
│   │   └── TodaySummary.js      # Salesman's today-at-a-glance view with comparisons
│   ├── context/
│   │   └── auth.js              # AuthProvider + useAuth hook (JWT in localStorage)
│   └── lib/
│       ├── api-client.js        # Frontend fetch wrapper with auth headers
│       ├── auth.js              # JWT sign/verify, requireAuth/requireAdmin middleware
│       └── db/
│           ├── index.js         # SQLite connection singleton, bill number generator, IST helper
│           ├── schema.sql       # Database schema (CREATE TABLE statements)
│           └── seed.js          # Seed script: creates DB, inserts default users + categories
├── next.config.js               # better-sqlite3 externalized for server
├── tailwind.config.js           # Content paths, brand color palette
├── package.json                 # Dependencies and scripts
└── .env.local                   # JWT_SECRET (not committed)
```

## Database Schema

Seven tables, all timestamps in IST (UTC+5:30 via SQLite offset):

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
| discount_percent | REAL | 0-100, always stored as percentage |
| discount_amount | REAL | Calculated: subtotal * percent / 100 |
| total | REAL | subtotal - discount_amount |
| payment_mode | TEXT | `cash`, `upi`, `card`, or `mixed` |
| salesman_id | INTEGER FK | Who created the bill |
| notes | TEXT | Optional free text |
| deleted_at | DATETIME | Soft delete timestamp (NULL = active) |

### `bill_items`
| Column | Type | Notes |
|--------|------|-------|
| bill_id | INTEGER FK | CASCADE delete with parent bill |
| category_id | INTEGER FK | Which product category |
| quantity | INTEGER | Number of pieces (> 0) |
| amount | REAL | price_per_piece * quantity |

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
| reason | TEXT | `expense`, `supplier`, `owner`, or `other` |
| note | TEXT | Optional description |
| recorded_by | INTEGER FK | Who recorded this entry |

### `app_state`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Always `1` (single-row table) |
| cash_drawer | REAL | Persistent cash-in-drawer balance, updated atomically by every cash event |

Every cash mutation (sale with cash payment, cash refund, cash-out, bill void) updates `cash_drawer` inside the same DB transaction. Admin can manually correct via the Hisaab screen if physical count differs.

## API Routes

All routes are under `/api/`. Auth is via `Authorization: Bearer <JWT>` header.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | Public | Login (admin: username+password, salesman: id+pin) |
| GET | `/api/auth/me` | Bearer | Current user info |
| GET | `/api/auth/salesmen` | Public | List active salesmen names (for login screen) |
| POST | `/api/bills` | Bearer | Create bill with items + payments array |
| GET | `/api/bills` | Bearer | List bills (paginated, filtered). Salesmen see only their own. |
| DELETE | `/api/bills/:id` | Bearer | Soft-delete (admin: any time; salesman: own bills within 15 min) |
| POST | `/api/bills/:id/return` | Admin | Create return bill against an existing sale |
| GET | `/api/categories` | Bearer | List categories (grouped). `?all=true` includes inactive. |
| POST | `/api/categories` | Admin | Add new category |
| PATCH | `/api/categories/:id` | Admin | Update category name/group/active |
| GET | `/api/dashboard` | Bearer | Analytics. `?view=today\|week\|month` or `?from=&to=`. Includes previous period data. |
| GET | `/api/export` | Admin | CSV download. Optional `?from=&to=`. |
| GET | `/api/hisaab` | Bearer | Daily reconciliation: drawer balance, today's cash flow, sales summary |
| GET | `/api/cash-drawer` | Bearer | Current cash drawer balance |
| PUT | `/api/cash-drawer` | Admin | Manually correct drawer balance |
| POST | `/api/cash-out` | Bearer | Record cash leaving the drawer (auto-updates drawer) |
| GET | `/api/cash-out` | Bearer | List cash-out entries. `?from=&to=` for date filtering. |
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

Both databases are fully independent. You can seed dev repeatedly without affecting prod.

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

## UI Language

The app UI is in **Hinglish** (Hindi in Roman script) -- designed for non-tech-savvy salesmen in the shop. Examples: "Naya Bill Banao", "Category chuno", "Bill Save Karo".

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| SQLite (not Postgres/MySQL) | Single-file DB, zero setup, perfect for local single-shop deployment |
| PIN login for salesmen | Speed -- no typing usernames, just tap name + 4 digits |
| Split payments via `bill_payments` table | Captures exact cash/UPI/card split per bill for accurate drawer reconciliation |
| Discount stored as percentage | Consistent analytics even when discount is entered as a final price |
| Soft delete for bills | Preserve historical data integrity; deleted bills excluded from analytics |
| Deactivate (not delete) salesmen with bills | Referential integrity; historical bills retain salesman association |
| Cash-out log separate from bills | Non-sale cash movements (expenses, supplier, owner withdrawal) tracked independently |
| Persistent cash drawer (not daily calculation) | Single `app_state.cash_drawer` value updated by every cash event in the same transaction -- no carry-forward logic, no daily opening ceremony. Admin corrects via "Correct Karo" if physical count differs. |
| Bill number format `MJF-XXXX` | Human-readable, sequential, internal-only |
| IST timestamps via SQLite offset | No timezone library needed; all users are in one timezone |
| JWT in localStorage | Simple SPA auth; acceptable for internal-only tool on local network |
| No inventory/stock tracking (yet) | MVP focuses on sales data capture; stock is a future phase |

## Seeded Categories

| Group | Categories |
|-------|-----------|
| Women (Ladies) | Kurti, Top, Palazzo/Pant, Dupatta, Dress, Saree, Legging |
| Kids | Boys T-shirt, Boys Pant, Girls Top, Girls Dress, Girls Legging |
| Men (Gents) | Shirt, T-shirt, Pant, Jeans |
| Other | Other (catch-all custom category) |

Categories are fully manageable via Admin > Settings > Categories tab.

## Related Documents

- [`CHANGELIST.md`](./CHANGELIST.md) -- Sprint changelog with test instructions
- [`DEFERRED_FEATURES.md`](./DEFERRED_FEATURES.md) -- Features analyzed but postponed
- [`ISSUES_FOUND.md`](./ISSUES_FOUND.md) -- Stress test findings and fixes
- [`docs/google-business-profile-guide.md`](../docs/google-business-profile-guide.md) -- Hinglish guide for Google Maps listing
- [`docs/clearance-sale-strategy-guide.md`](../docs/clearance-sale-strategy-guide.md) -- Hinglish guide for clearance sales
