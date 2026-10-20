# Custody Ops Console: coding challenge

Thanks for taking the time to do this. Please read the whole brief before you start.

## The situation

Vellum Fund Services (fictional) administers investment portfolios for about 2,000 clients. Its
operations team lives in a back-office web app all day: looking up clients, checking and approving
transactions, billing clients every month, and loading files from the custodian bank.

That app needs to be rebuilt. You are building the first version from scratch.

## Constraints

- **Backend:** Node.js. **Frontend:** React. **Database:** MySQL 8.
- `docker compose up` from a clean clone must start everything and load all the data in `data/`.

## What to build

The data is in [`data/`](data); [`data/README.md`](data/README.md) describes every file and the
business rules.

Expect to spend **6 to 8 hours**. That is not enough to do everything perfectly, so prioritize the
**Must** items. Unfinished work that is clearly marked as such beats rushed work.

### Must

**Sign-in and roles.** The users in `data/users.json` sign in with email and password.

| Role     | Can                                                                                     |
| -------- | --------------------------------------------------------------------------------------- |
| Viewer   | See everything, change nothing                                                          |
| Operator | Edit clients, approve or cancel transactions, generate and issue invoices, import files |
| Admin    | Everything an operator can, plus mark invoices paid or void them                        |

**Clients.** A grid of all clients. Ops works in these grids all day: they sort, filter (type, country,
KYC status, relationship manager), search by name, and page through results. They also paste links to
exactly what they're looking at into team chat, so a link must reopen the same view. The grids must
stay fast with the full data set.

**Client detail.** A page per client with tabs:

- _Overview:_ the client's details, editable. Relationship manager is chosen from the users. Two
  operators often have the same client open at once; neither should silently lose the other's changes.
- _Portfolios:_ the client's portfolios.
- _Transactions:_ the client's transactions, filterable.
- _Invoices:_ the client's invoices.

Each tab needs its own URL.

**Transactions.** A grid of all 50,000 transactions with the same expectations as the clients grid.
Operators select transactions and approve them (`PENDING` → `SETTLED`) or cancel them (`PENDING` →
`CANCELLED`) in bulk. Only pending transactions can change. When a selection mixes pending and other
transactions, the operator must be able to see what happened to each one.

**Invoices.** An operator generates a client's invoice for a month, using the fee rules in
`data/README.md`. Invoices go `DRAFT` → `ISSUED` → `PAID`, or are made `VOID` by an admin. A client
has at most one invoice per month that isn't void, and an issued invoice can't change. Invoice totals
must reconcile to the cent with their lines.

### Should

**Import.** Operators upload the custodian's monthly export
(`data/import/custodian-export-2026-09.csv`; the format is in `data/README.md`). Valid rows become
transactions. Invalid rows are reported back row by row, with the reason, so ops can fix them at the
source. Ops sometimes uploads the same file twice.

**Audit trail.** Every change to a client, a transaction's status or an invoice can be traced: who, when,
what changed. Shown on the client page as an _Audit log_ tab.

**Export.** Download the transactions grid's current view (filters and sorting applied) as CSV.

## Handing in

Put your solution in a **private GitHub repository**, give access to the GitHub accounts named in our
email, and reply with the link.
