import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildInvoice, money, transactionFee } from '../src/lib/fees.js'

const schedule = {
  billingCurrency: 'EUR',
  transactionFees: {
    BUY: { kind: 'PERCENT_OF_GROSS', rate: '0.0010', minimum: '15.00', maximum: '250.00' },
    SELL: { kind: 'PERCENT_OF_GROSS', rate: '0.0010', minimum: '15.00', maximum: '250.00' },
    TRANSFER_IN: { kind: 'FLAT', amount: '25.00' },
    TRANSFER_OUT: { kind: 'FLAT', amount: '25.00' },
  },
  monthlyAccountFee: { RETAIL: '9.90', INSTITUTIONAL: '450.00' },
}
const rates = { '2026-03-02|USD': '0.926089' }
const fx = (d, c) => rates[`${d}|${c}`] ?? null

test('BUY in EUR: 0.10% of gross, rounded half-up to the cent', () => {
  // 1000 x 30.005 = 30005.00 -> fee 30.005 -> 30.01
  const f = transactionFee({ id: 'T', type: 'BUY', quantity: '1000', price: '30.005', currency: 'EUR', tradeDate: '2026-03-02' }, schedule, fx)
  assert.equal(money(f.fee), '30.01')
})

test('minimum and maximum are applied', () => {
  const small = transactionFee({ id: 'T', type: 'SELL', quantity: '1', price: '10', currency: 'EUR' }, schedule, fx)
  const big = transactionFee({ id: 'T', type: 'SELL', quantity: '500000', price: '460.88', currency: 'EUR' }, schedule, fx)
  assert.equal(money(small.fee), '15.00')
  assert.equal(money(big.fee), '250.00')
})

test('foreign currency converts at the trade date rate', () => {
  // 20000 x 100 USD = 2,000,000 USD x 0.926089 = 1,852,178 EUR -> capped at 250
  // 1000 x 100 USD = 100,000 USD x 0.926089 = 92,608.90 EUR -> 92.6089 -> 92.61
  const f = transactionFee({ id: 'T', type: 'BUY', quantity: '1000', price: '100', currency: 'USD', tradeDate: '2026-03-02' }, schedule, fx)
  assert.equal(money(f.fee), '92.61')
  assert.equal(f.fxRate.toString(), '0.926089')
})

test('missing FX rate is an error, never a silent zero', () => {
  assert.throws(() => transactionFee({ id: 'T9', type: 'BUY', quantity: '1', price: '1', currency: 'GBP', tradeDate: '2026-03-02' }, schedule, fx), /No GBP FX rate/)
})

test('transfers are flat 25.00', () => {
  const f = transactionFee({ id: 'T', type: 'TRANSFER_OUT', quantity: '5', price: null, currency: 'CHF' }, schedule, fx)
  assert.equal(money(f.fee), '25.00')
})

test('invoice lines per fee type + account fee, total reconciles to the cent', () => {
  const transactions = [
    { id: 'A', type: 'BUY', quantity: '333', price: '33.333', currency: 'EUR', tradeDate: '2026-03-02' }, // 11099.889 -> 11.10 -> min 15
    { id: 'B', type: 'BUY', quantity: '100', price: '200.005', currency: 'EUR', tradeDate: '2026-03-02' }, // 20000.5 -> 20.0005 -> 20.00
    { id: 'C', type: 'SELL', quantity: '1000', price: '100', currency: 'USD', tradeDate: '2026-03-02' }, // 92.61
    { id: 'D', type: 'TRANSFER_IN', quantity: '10', price: null, currency: 'EUR', tradeDate: '2026-03-02' },
  ]
  const inv = buildInvoice({ transactions, schedule, fxRate: fx, clientType: 'RETAIL', hasActivePortfolio: true })
  assert.deepEqual(inv.lines.map((l) => [l.kind, l.quantity, money(l.amount)]), [
    ['BUY', 2, '35.00'], ['SELL', 1, '92.61'], ['TRANSFER_IN', 1, '25.00'], ['ACCOUNT_FEE', 1, '9.90'],
  ])
  assert.equal(money(inv.total), '162.51')
  const sumOfLines = inv.lines.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0)
  assert.equal(sumOfLines, 16251)
})

test('no account fee without an active portfolio', () => {
  const inv = buildInvoice({ transactions: [], schedule, fxRate: fx, clientType: 'INSTITUTIONAL', hasActivePortfolio: false })
  assert.equal(inv.lines.length, 0)
  assert.equal(money(inv.total), '0.00')
})
