import Decimal from 'decimal.js'

// All money maths uses decimal.js, never JS floats.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export const LINE_ORDER = ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT']
const LINE_LABEL = {
  BUY: 'Buy transaction fees',
  SELL: 'Sell transaction fees',
  TRANSFER_IN: 'Transfer-in fees',
  TRANSFER_OUT: 'Transfer-out fees',
}

const cents = (d) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)

/**
 * Fee for one transaction, in EUR, rounded to the cent.
 * fxRate(date, currency) must return the EUR-per-unit rate as a string/Decimal (or null if missing).
 */
export function transactionFee(tx, schedule, fxRate) {
  const rule = schedule.transactionFees[tx.type]
  if (!rule) throw new Error(`No fee rule for transaction type ${tx.type}`)

  if (rule.kind === 'FLAT') {
    return { gross: null, fxRate: null, grossEur: null, fee: cents(new D(rule.amount)) }
  }
  if (rule.kind === 'PERCENT_OF_GROSS') {
    if (tx.price === null || tx.price === undefined) throw new Error(`Transaction ${tx.id} has no price`)
    const gross = new D(tx.quantity).times(tx.price)
    const rate = tx.currency === schedule.billingCurrency ? new D(1) : fxRate(tx.tradeDate, tx.currency)
    if (rate === null || rate === undefined) {
      throw new Error(`No ${tx.currency} FX rate for ${tx.tradeDate} (needed for ${tx.id})`)
    }
    const grossEur = gross.times(rate)
    // Round to the cent first, then clamp; the bounds are whole cents, so the order doesn't change the result.
    const fee = D.min(D.max(cents(grossEur.times(rule.rate)), rule.minimum), rule.maximum)
    return { gross, fxRate: new D(rate), grossEur, fee: cents(fee) }
  }
  throw new Error(`Unknown fee kind ${rule.kind}`)
}

/**
 * Builds the invoice for one client and month from its settled transactions.
 * Each line amount is the sum of already-rounded per-transaction fees, and the total is the sum of
 * the lines, so the invoice reconciles to the cent by construction.
 */
export function buildInvoice({ transactions, schedule, fxRate, clientType, hasActivePortfolio }) {
  const items = transactions.map((tx) => ({ transactionId: tx.id, kind: tx.type, ...transactionFee(tx, schedule, fxRate) }))

  const lines = []
  for (const kind of LINE_ORDER) {
    const ofKind = items.filter((i) => i.kind === kind)
    if (ofKind.length === 0) continue
    lines.push({
      kind,
      description: LINE_LABEL[kind],
      quantity: ofKind.length,
      amount: ofKind.reduce((sum, i) => sum.plus(i.fee), new D(0)),
    })
  }
  if (hasActivePortfolio) {
    lines.push({
      kind: 'ACCOUNT_FEE',
      description: `Monthly account fee (${clientType.toLowerCase()})`,
      quantity: 1,
      amount: cents(new D(schedule.monthlyAccountFee[clientType])),
    })
  }
  const total = lines.reduce((sum, l) => sum.plus(l.amount), new D(0))
  return { items, lines, total }
}

export const money = (d) => (d === null ? null : new D(d).toFixed(2))
export const exact = (d) => (d === null ? null : new D(d).toFixed(6))
