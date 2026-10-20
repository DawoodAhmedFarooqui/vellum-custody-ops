# Data

All data is fictional. ISINs use the prefix `ZZ`, which is not assigned to any country, so they have
valid check digits but never match a real security.

| File | Rows | Contents |
| --- | --- | --- |
| `users.json` | 6 | Staff who use the app, with their role |
| `clients.json` | 2,000 | Vellum's clients |
| `portfolios.json` | 3,030 | Clients' portfolios; a client has one or more |
| `instruments.json` | 300 | Securities that can be held and traded |
| `transactions.csv` | 50,000 | Transactions from January to September 2026 |
| `fx-rates.csv` | 819 | Daily FX rates to EUR |
| `fee-schedule.json` | 1 | Fee rules used for invoicing |
| `import/custodian-export-2026-09.csv` | 297 | The custodian's September export, to be imported |

## users.json

`id`, `email`, `name`, `role` (`ADMIN`, `OPERATOR` or `VIEWER`).

Every user's initial password is `Challenge-2026!`. Store passwords the way you would in production.

## clients.json

| Field | Notes |
| --- | --- |
| `id` | `C-00001` … |
| `name` | |
| `type` | `RETAIL` or `INSTITUTIONAL` |
| `country` | ISO 3166-1 alpha-2 |
| `kycStatus` | `APPROVED`, `PENDING`, `EXPIRED`, `REJECTED` |
| `email`, `phone` | |
| `relationshipManagerId` | a user `id` |
| `onboardedOn` | `YYYY-MM-DD` |

## portfolios.json

`id` (`P-00001` …), `clientId`, `name`, `baseCurrency` (always `EUR`), `status` (`ACTIVE` or `CLOSED`).

## instruments.json

`isin`, `name`, `type` (`EQUITY`, `BOND`, `FUND`), `currency` (`EUR`, `USD`, `CHF`, `GBP`).

## transactions.csv

| Column | Notes |
| --- | --- |
| `id` | `T-000001` … |
| `externalRef` | the custodian's reference; unique |
| `clientId`, `portfolioId` | the portfolio always belongs to the client |
| `isin` | |
| `type` | `BUY`, `SELL`, `TRANSFER_IN`, `TRANSFER_OUT` |
| `tradeDate`, `settlementDate` | `YYYY-MM-DD` |
| `quantity` | units (bonds: nominal) |
| `price` | per unit, in the transaction currency; empty for transfers |
| `currency` | always the instrument's currency |
| `status` | `PENDING`, `SETTLED`, `CANCELLED`, `FAILED` |

Gross amount = `quantity × price`.

## fx-rates.csv

`date`, `currency`, `eurPerUnit`: how many EUR one unit of the currency is worth on that date. There is
a rate for every calendar day from 2026-01-01 to 2026-09-30 for USD, CHF and GBP. EUR is always 1 and
isn't listed.

## Invoicing rules

An invoice covers one client and one calendar month, and is billed in EUR.

- **Which transactions:** the client's `SETTLED` transactions whose **settlement date** falls in that
  month.
- **Transaction fees** (from `fee-schedule.json`):
  - `BUY` and `SELL`: 0.10% of the gross amount converted to EUR at the **trade date's** rate. Minimum
    EUR 15.00, maximum EUR 250.00 per transaction.
  - `TRANSFER_IN` and `TRANSFER_OUT`: EUR 25.00 flat per transaction.
- **Monthly account fee:** EUR 9.90 for retail clients, EUR 450.00 for institutional clients, charged
  if the client has at least one active portfolio.
- Show the fees on the invoice as one line per fee type with the number of transactions, plus the
  account fee line.
- Amounts are in euros and cents.

## Custodian import format

`import/custodian-export-2026-09.csv` is the custodian's standard monthly export. It comes from a
German system, so:

- UTF-8 with a byte order mark, Windows line endings, `;` as the separator.
- Dates are `DD.MM.YYYY`.
- Numbers use `.` for thousands and `,` for decimals: `1.234,56` is one thousand two hundred thirty-four
  and 56 hundredths, and `12.500` is twelve thousand five hundred.

| Column | Meaning |
| --- | --- |
| `Referenz` | the custodian's reference (becomes `externalRef`) |
| `Kunde` | client id |
| `Depot` | portfolio id |
| `ISIN` | |
| `Art` | `BUY`, `SELL`, `TRANSFER_IN`, `TRANSFER_OUT` |
| `Handelstag` | trade date |
| `Valuta` | settlement date |
| `Stueck` | quantity |
| `Kurs` | price; empty for transfers |
| `Waehrung` | currency |

Imported transactions start as `PENDING`.

The custodian's file isn't always clean.
