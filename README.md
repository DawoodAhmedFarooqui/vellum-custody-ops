# Custody Ops Console

Back-office web app for Vellum Fund Services (fictional): clients, transactions, monthly invoicing and
custodian file import. Built for the Chartered Investment coding challenge; the original brief is in
[ASSIGNMENT.md](ASSIGNMENT.md) and the data description in [data/README.md](data/README.md).

**Stack:** Node.js 22 + Express 5 · React 19 + MUI (DataGrid) + React Router + TanStack Query · MySQL 8.4 · Docker Compose.

## Run it

```bash
docker compose up --build
```

Then open <http://localhost:8080>. On first start the server creates the schema and loads everything in
`data/` (about 10 seconds); later starts skip the load. Sign in as any user from `data/users.json`, password
`Challenge-2026!`:

| Email                             | Role     |
| --------------------------------- | -------- |
| anna.keller@vellum.example        | Admin    |
| tobias.brandt@vellum.example      | Operator |
| lea.fischer@vellum.example        | Operator |
| marco.rossi@vellum.example        | Operator |
| julia.wagner@vellum.example       | Viewer   |
| samir.haddad@vellum.example       | Viewer   |

To start over with fresh data: `docker compose down -v && docker compose up --build`.

### Local development

```bash
npm run install:all          # root, server and client dependencies
docker compose up -d mysql   # only the database
npm run dev                  # API on :4000 (with --watch) and Vite on :5173 (proxies /api)
npm test --prefix server     # unit tests for fee calculation and import parsing/validation
```

## What is implemented

Everything in the **Must** and **Should** lists of the brief:

- **Sign-in and roles.** Email + password (bcrypt hashes), session in an `HttpOnly`/`SameSite=Strict` cookie (JWT, 10 h),
  five failed attempts lock that address + email for five minutes. Permissions are enforced on the server per route
  (`server/src/lib/auth.js`); the UI only hides what the role can't do.
- **Clients grid.** Server-side paging, sorting, filters (type, country, KYC, relationship manager) and name/ID search.
  The whole grid state lives in the URL, so a copied link reopens the same view (e.g. `/clients?type=INSTITUTIONAL&country=DE&sort=name&dir=desc&page=1`).
- **Client detail** with tabs at their own URLs: Overview (editable; RM picked from users), Portfolios, Transactions, Invoices, Audit log.
  Edits use optimistic locking: each client has a `version`; saving with a stale version returns 409 and the UI shows both versions
  field by field, so the operator chooses to take the other person's version or overwrite it. Nothing is lost silently.
- **Transactions grid** over all 50,000 rows with the same URL-state behaviour, plus date ranges and free-text search.
  Operators tick pending rows and approve or cancel them in bulk; the response lists the outcome of every selected id
  (updated / skipped with its current status / not found) and the UI shows that table.
- **Invoices.** Generated per client and month from `data/fee-schedule.json`; DRAFT → ISSUED → PAID, VOID by admins.
  A generated database column plus a unique key guarantee at most one non-void invoice per client and month, even under
  concurrent requests. Issued invoices are immutable. Every invoice stores its per-transaction fee breakdown.
- **Import** of the custodian's monthly CSV (BOM, CRLF, `;`, German dates and numbers). Each row is validated against the
  reference data and reported with all of its problems. Re-uploads are recognised row by row (same `Referenz` and same
  content → "already imported as T-…"), so uploading the same file twice never creates duplicates. Every import run is kept
  and can be reopened.
- **Audit trail** for client edits, transaction status changes (including imports) and invoice changes: who, when and the
  field-level before/after, shown on the client's Audit log tab with links to the entities.
- **Export** of the transactions grid's current view (filters and sorting applied, all pages) as CSV, streamed from the database.

## Design notes

**Money.** All amounts are `DECIMAL` in MySQL and `decimal.js` in Node; the API returns them as strings and nothing
touches a JS float. Each transaction fee is rounded to the cent (half up) first, each invoice line is the sum of those
rounded fees and the total is the sum of the lines, so an invoice reconciles to the cent by construction. The per-transaction
figures (gross, FX rate, gross in EUR, fee) are stored with the invoice so every cent is traceable.

**Fee rules, as read from `data/README.md`.** Transactions are selected by *settlement date* in the month and status
`SETTLED`; BUY/SELL fees are 0.10 % of gross converted at the *trade date's* rate, clamped to 15–250 EUR; transfers 25 EUR
flat; account fee 9.90 / 450.00 EUR when the client has at least one `ACTIVE` portfolio. Two judgement calls I made:

- Only completed months can be invoiced, since more transactions may still settle in a running month.
- Issuing re-checks the draft against the current data and refuses if the amounts changed (e.g. transactions approved after the
  draft was generated); the operator recalculates the draft first. A draft can be recalculated at any time.

**Grids.** Paging, sorting and filtering happen in SQL with indexes on every filterable/sortable column; sort columns come
from a whitelist. A page of 50 rows deep into the 50k transactions returns in well under 100 ms.

**Concurrency.** Client edits: version check inside a transaction with `SELECT … FOR UPDATE`. Bulk status changes lock the
selected rows and only update rows that are still `PENDING`, so two operators acting on the same selection can't both "win".
Invoice creation: unique key on `(client_id, period, live_marker)` where `live_marker` is `NULL` for void invoices. Imports:
a named MySQL lock serialises concurrent uploads.

**Import policy.** Stray whitespace around values is trimmed; everything else must match the spec exactly (`usd`, `EURO`,
`KAUF`, ISO dates, `1,234.56`) and is reported so ops can fix it at the source. ISINs are checked for format and check digit.
A `Referenz` that already exists with *different* data is an error, not a silent skip, because it means the custodian
reused a reference. Rows with duplicate references inside one file are accepted once.

**Data loading.** The server applies `server/src/db/schema.sql` (idempotent) on every start and loads `data/` once, guarded by
a marker row taken `FOR UPDATE`, so several instances can start at once. Loading is done in a single transaction with batched
inserts.

## Assumptions and judgement calls

Where the brief left room, this is what I chose, and why:

| Decision | Reason |
| --- | --- |
| Only completed months can be invoiced | Transactions may still settle in a running month; an early invoice would be wrong by construction. |
| Issuing refuses a draft whose amounts no longer match the data | Issued invoices are immutable, so they must be right at the moment of issue. Recalculate, then issue. |
| Voiding needs a reason | A void is an exception that ops and auditors will ask about later. |
| Import trims stray whitespace but rejects everything else (`usd`, `EURO`, `KAUF`, ISO dates, `1,234.56`) | Whitespace is unambiguous; the rest may be a different meaning. The brief wants problems fixed at the source. |
| A `Referenz` already known with *different* data is an error, not a duplicate | The custodian reused a reference; silently skipping would hide a real problem. Same reference + same data is a benign re-upload. |
| Rows for a `CLOSED` portfolio are rejected | A closed portfolio should not receive new business; ops can reopen it or query the custodian. |
| Imported transactions continue the `T-` id sequence | Keeps one id scheme across loaded and imported data. |
| Account fee applies when the client has ≥ 1 `ACTIVE` portfolio at generation time | Literal reading of the rule; there is no portfolio history in the data. |

## How it was verified

- `npm test --prefix server`: 16 unit tests for the fee maths (rounding, clamps, FX, reconciliation) and the import parser/validator
  (German numbers and dates, ISIN check digit, every error category in the sample file, re-upload detection).
- Every API route exercised with curl as viewer, operator and admin, including malformed input (bad enums, dates, ids, paging), and
  race conditions run in parallel: two edits of the same client, approve vs cancel of the same transaction, three simultaneous
  invoice generations, two simultaneous uploads of the same file. Each produced exactly one winner and clean 409s.
- A SQL check over all generated invoices: total = Σ lines = Σ per-transaction fees + account fee, every fee within 15–250 EUR.
- A scripted browser walkthrough (Playwright on Chrome) of the whole UI, run against the Docker build from a wiped database: deep
  link → login → same view, filters, conflict dialog, invoice lifecycle, bulk approve, import, viewer restrictions.
- `docker compose down -v && docker compose up --build` from scratch: 50,000 transactions loaded in about 10 seconds.

## Project layout

```
server/src
  index.js            start-up: migrate, seed, listen
  app.js              express app, routes, error handling
  db.js, db/          pool, schema.sql, setup (migrate + seed)
  lib/                auth (sessions, permissions), fees (pure fee maths), custodianImport (pure parsing/validation),
                      audit, listQuery (paging/filter helpers), errors
  routes/             auth, reference, clients, transactions, invoices, imports, health
server/test           unit tests (node:test) for fees and custodian import
client/src
  App.jsx             routes; main.jsx providers
  components/         ServerGrid (DataGrid bound to URL state), filters, Layout, Toast, common
  pages/              Login, Clients, ClientDetail (tabs), Transactions, Invoices, InvoiceDetail, Import
  useUrlState.js      grid state <-> URL query string
```

## API overview

All routes are under `/api` and need a session except `auth/login` and `health`. Write routes check a permission.

| Method | Route | Permission |
| --- | --- | --- |
| POST | `auth/login`, `auth/logout`; GET `auth/me` | – |
| GET | `reference` (pick lists) | – |
| GET | `clients`, `clients/:id`, `clients/:id/portfolios`, `clients/:id/audit` | – |
| PUT | `clients/:id` (body includes `version`) | client:edit |
| GET | `transactions`, `transactions/export.csv` | – |
| POST | `transactions/bulk-status` `{ action: APPROVE\|CANCEL, ids }` | transaction:status |
| GET | `invoices`, `invoices/:id` | – |
| POST | `invoices` `{ clientId, period }`, `invoices/:id/regenerate` | invoice:generate |
| POST | `invoices/:id/issue` | invoice:issue |
| POST | `invoices/:id/pay` | invoice:pay (admin) |
| POST | `invoices/:id/void` `{ reason }` | invoice:void (admin) |
| GET | `imports`, `imports/:id` | – |
| POST | `imports` (multipart `file`) | import:run |

Grid routes take `page`, `pageSize`, `sort`, `dir` and the filters shown in the UI (comma-separated lists).

## Not done / known gaps

Clearly marked rather than rushed:

- **Automated tests** cover the two pure modules (fee maths, import parsing/validation). The routes and UI were verified as
  described above, but those checks are scripts I ran, not tests in the repo.
- **Audit log** is per client and capped at the latest 1,000 entries; there is no global audit screen or filtering.
- **Invoices** have no PDF/print layout; the global invoice list filters by status only.
- **Portfolios and users** are read-only (no screens to manage them); instruments and FX rates are only loaded, never updated.
- The client's Invoices tab lists up to 200 invoices without paging (enough for 9 months of data).
- The client bundle is a single chunk (~340 kB gzipped); no code splitting.

## Production readiness: what this is and isn't

This is a working first version with the right foundations (hashed passwords, server-side authorisation, decimal money,
database-enforced invariants, transactions and row locks around every multi-step write, audit trail). It is **not** yet
something I would put in front of real clients' data. What I would do next, in order:

1. **Secrets and transport.** `JWT_SECRET` and database credentials come from the environment, but `docker-compose.yml`
   ships placeholders. Real deployment needs a secret store, TLS termination (then `COOKIE_SECURE=true`), and security headers
   (CSP, HSTS).
2. **Sessions.** Stateless JWTs can't be revoked. Move to server-side sessions (or a token denylist) with idle timeout, and
   add password change / reset and ideally MFA for admins. The login brake is in-memory per process; it needs a shared store
   (Redis) once there is more than one instance.
3. **Schema migrations.** The schema is applied idempotently on start, which is fine for v1 but not for evolving a live
   database. Introduce versioned migrations (e.g. Knex or Flyway) and run them as a deploy step, not at app start.
4. **Test automation and CI.** API integration tests against a throwaway MySQL (testcontainers), Playwright end-to-end tests
   for the critical flows, and a CI pipeline that runs lint, unit, integration and the Docker build on every push.
5. **Observability.** Structured JSON logs with request ids, metrics (request latency, DB pool usage, import/invoice counts),
   error tracking, and separate liveness/readiness probes (readiness should fail while seeding).
6. **Operations.** Database backups and restore drill, non-root containers, image vulnerability scanning, resource limits,
   graceful shutdown (finish in-flight requests, close the pool). Keep uploaded import files (object storage) so an import can
   be reprocessed or audited later.
7. **Scale.** Current data (2k clients, 50k transactions) is small for MySQL; the indexed queries will hold up to millions of rows.
   Beyond that: keyset pagination instead of `OFFSET` for very deep pages, cached counts, and a read replica for exports.
8. **Product.** Invoice PDF and email, global audit screen, user and portfolio management, FX rate ingestion, scheduled
   month-end invoicing for all clients with an approval queue.

## AI assistance

The app was built with Claude Code (Anthropic). The complete, unedited conversation history is in
[`ai-transcript/`](ai-transcript/): the raw Claude Code session logs, a readable Markdown rendering of each
session, the script that produced it, and a reading guide that walks through what happened in order, including
the parts that did not go to plan.
