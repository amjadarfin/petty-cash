# Petty Cash Management System — Next.js + PostgreSQL

A full-stack rebuild of the petty cash workflow (submission -> Deputy Director approval ->
Director final approval -> payment/settlement) using Next.js (App Router, Server Actions),
Prisma ORM, and PostgreSQL -- instead of SharePoint + Power Automate. Same roles, statuses,
and business rules as the requirements document; different plumbing underneath.

## What's implemented

- Role-based login (Staff, Deputy Director, Director, Accounts, System Owner)
- Draft -> Submit -> Deputy Director review -> Director final approval -> Payment -> Settlement
- Receipt/evidence upload with type and size validation
- **Concurrency-safe voucher numbering** -- uses a Postgres row lock (`SELECT ... FOR UPDATE`
  inside a transaction) so two simultaneous submissions can never collide, the direct
  equivalent of the ETag/If-Match retry loop in the SharePoint guide
- Budget head tracking with threshold warnings, fiscal-year allocation and available balance
- Director's final approval is **blocked at the database level** if the amount would exceed
  the available balance -- not just a warning
- **Possible-duplicate detection** -- flags (does not block) requests that match an existing
  one on requester, vendor, date and amount, shown to the reviewer on the request detail page
- Full audit trail (every submission, decision, and payment is logged with actor + timestamp)
- Petty cash register, reports, and an admin screen for budget heads
- Mandatory approval comments, return/reject/resubmit cycle tracking
- **User management** (System Owner) -- create staff accounts, deactivate departures,
  admin-initiated password reset, at `/admin/users`
- **Self-service password change** for any signed-in user, at `/account`
- **Delegation / backup approvers** (System Owner) -- set a primary and backup approver per
  role with an active date range, at `/admin/approvers`. Requests route to the backup
  automatically while a delegation window is active.
- **Fiscal year closure & carryforward** (System Owner) -- closes the current year (blocked if
  any requests are still in progress), computes the unspent balance, and opens the next year
  with an option to carry the unspent balance forward. Also: edit the current year's
  allocation directly (mid-year top-up), and create a fiscal year independently of closing --
  all on the Admin page.
- **Email notifications** -- on submission, DD decision, Director decision, and payment
  recorded, via Resend's free tier. Runs with zero email setup too -- notifications are simply
  skipped (logged to the console) until you add a `RESEND_API_KEY`. See "Email setup" below.
- **Excel-compatible export** -- "Export to Excel" on the Register and Reports pages. Produces
  real CSV (opens natively in Excel, no import dialog) rather than pulling in the `xlsx` npm
  package, which currently has unpatched high-severity vulnerabilities.
- **Sidebar notification badges** -- a pulsing count badge appears next to the relevant nav
  item when there's something to act on (Deputy Director sees pending submissions, Director
  sees pending final approvals, Accounts sees requests awaiting payment, Staff see returned
  requests needing their attention).
- **Bulk CSV import** -- for staff accounts and budget heads, both under Admin, with the exact
  column format shown inline on each page.
- **Tabbed Admin section** -- Fiscal Years & Budget / User Management / Approvers & Delegation
  now share one consistent tab bar instead of separate disconnected pages.
- **Full report suite** -- Fiscal Year Summary, Budget Head Utilization, Pending Approvals,
  Monthly Expenditure, Approval History, Payment & Settlement, Exceptions, and Delegation Log,
  all under `/reports` with tabs, each with its own Excel-compatible export. The Petty Cash
  Register (`/register`) and Audit Extract (`/audit`) also export. Every export includes the
  generation date, fiscal year, and filters applied, per policy. Amendments, cancellations, and
  workflow-engine "failed flow" events aren't tracked (there's no separate workflow engine to
  fail in this architecture) -- the Exceptions report says so explicitly rather than showing
  empty sections that imply coverage that isn't there.
- Warm, soft pastel-card theme (cream background, white rounded cards, peach/orange accent) --
  swap `app/globals.css` again any time you want a different look; nothing else needs to change.
- Dark theme throughout, richer multi-hue palette (distinct colors per approval stage)

## What's not built yet (honest scope note)

- Teams notifications (email only for now) and the automated reminder/escalation flow that
  nudges an approver after N days of inaction (F-07 in the SharePoint guide) -- notifications
  fire on state changes, but nothing runs on a timer yet
- Full cancellation/amendment workflow for already-approved requests (F-09) -- not built
- Evidence files are stored on local disk by default -- fine for a VPS or your own server,
  **but not fine for Vercel's serverless functions**, which have an ephemeral filesystem. If
  you deploy to Vercel, see "File storage on Vercel" below before going live.

Ask if you'd like any of these added.

## Email setup (optional but recommended)

1. Go to **https://resend.com**, sign up free (no card, 100 emails/day/3,000 a month free)
2. Create an API key
3. Add to `.env`:
   ```
   RESEND_API_KEY="re_your_key_here"
   RESEND_FROM_EMAIL="Petty Cash System <onboarding@resend.dev>"
   ```
   The `onboarding@resend.dev` sender works immediately with no setup for testing. To send
   from your own domain (e.g. `noreply@yourorg.gov`), verify that domain in the Resend
   dashboard first, then use that address instead.
4. Restart the app. That's it -- submissions, decisions, and payments now email the right
   person automatically. No key set: the app runs exactly as before, just silently, logging
   what it would have sent to the server console instead.

---

## 1. Get a free PostgreSQL database

**Neon** (recommended -- generous free tier, no credit card):
1. Go to https://neon.tech and sign up (GitHub or email)
2. Create a project -- pick a region close to you
3. Copy the connection string it gives you (starts with `postgresql://...`)

**Supabase** is a fine alternative (Settings -> Database -> Connection string), with the caveat
that free projects pause after 7 days of no activity (one click in the dashboard wakes it
back up).

## 2. Local setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:
- `DATABASE_URL` -- paste your Neon/Supabase connection string
- `AUTH_SECRET` -- generate one with `openssl rand -base64 32` (or any random 32+ character string)
- `NEXTAUTH_URL` -- leave as `http://localhost:3000` for local dev

Create the database tables and seed sample data:
```bash
npx prisma migrate dev --name init
npm run db:seed
```

The seed script prints the login emails it created. All seeded accounts use the password
`Passw0rd!` -- **change these before real use** (via Prisma Studio: `npm run db:studio`, or
build a password-change screen).

Run it locally:
```bash
npm run dev
```
Open http://localhost:3000 and sign in.

## 3. Deploy for free (Vercel)

1. Push this project to a GitHub repository
2. Go to https://vercel.com, sign up free, click **Add New -> Project**, import your repo
3. Add the same three environment variables from your `.env` in Vercel's project settings
   (`DATABASE_URL`, `AUTH_SECRET`, and set `NEXTAUTH_URL` to your Vercel URL once you have it,
   e.g. `https://your-app.vercel.app`)
4. Deploy. Vercel's free "Hobby" tier is enough for an internal office tool at this scale.

### File storage on Vercel

Vercel's serverless functions don't keep files written to disk between requests -- anything
saved to `/storage/evidence` will vanish. Two options:

- **Easiest fix:** deploy instead to a small always-on host with persistent disk -- a cheap
  VPS, Render's free web service tier, or Railway's free trial -- where the current local-disk
  code works as-is.
- **Stay on Vercel:** swap the file-saving code in `lib/actions.ts` (`saveEvidence` function)
  for **Vercel Blob** (`npm install @vercel/blob`), which has a free allowance and a very
  similar API (`put(filename, buffer)` instead of `fs.writeFile`). Ask and I'll make this swap.

## 4. Everyday operations

- **Add a new staff member:** System Owner login -> Admin -> User Management (`/admin/users`) --
  no database tool needed anymore.
- **Reset a forgotten password:** same page, "Reset..." next to their name. Anyone can also
  change their own password at `/account` once signed in.
- **Set up delegation (e.g. Deputy Director on leave):** Admin -> Approver Configuration &
  Delegation (`/admin/approvers`) -- pick a backup approver and a date range.
- **Open a new fiscal year:** Admin page -> "Close [year] & Open Next Fiscal Year" -- blocked
  automatically if anything is still mid-approval for the current year.
- **Change budget limits or thresholds:** Admin screen in the app (System Owner login).
- **Inspect the database directly any time:** `npm run db:studio` opens a local browser UI
  over your real data.

## 5. Project structure

```
app/                  Pages (App Router) -- one folder per route
  requests/new         Submission form
  requests/mine         Staff's own requests
  requests/[id]          Detail view + review actions (context-aware by role)
  approvals/dd, approvals/director   Approval queues
  payments, payments/open            Accounts screens
  register, reports, admin, audit    Shared/reporting screens
  api/evidence/[...path]             Authenticated file download route
lib/
  auth.ts              NextAuth (Auth.js v5) credentials login
  prisma.ts            Prisma client singleton
  pettycash.ts          Voucher numbering, budget math, audit logging
  actions.ts            All Server Actions (the actual business logic)
prisma/
  schema.prisma        Full data model
  seed.ts               Sample users, fiscal year, budget heads
```

## 6. A note on Prisma versions

This project is pinned to **Prisma 6.x**, not the newly released Prisma 7. Prisma 7 changes
the configuration format entirely (a new `prisma.config.ts` file, mandatory driver adapters,
ESM-only) and has open issues with Next.js 16's Turbopack bundler as of this writing. Prisma
6 is stable, thoroughly documented, and everything in this project works with it today. If
you want to upgrade later, Prisma's official migration guide is at
https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
