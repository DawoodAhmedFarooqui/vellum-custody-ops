import { Router } from 'express'
import { z } from 'zod'
import { pool, withTransaction } from '../db.js'
import { audit } from '../lib/audit.js'
import { requirePermission } from '../lib/auth.js'
import { badRequest, conflict, notFound, parse } from '../lib/errors.js'
import { feeSchedule } from '../lib/feeSchedule.js'
import { buildInvoice, exact, money } from '../lib/fees.js'
import { listParam, paging } from '../lib/listQuery.js'

const router = Router()

const INVOICE_COLUMNS = `inv.id, inv.number, inv.client_id AS clientId, c.name AS clientName, inv.period, inv.status,
  inv.currency, inv.total, inv.created_at AS createdAt, cu.name AS createdByName, inv.issued_at AS issuedAt,
  inv.paid_at AS paidAt, inv.voided_at AS voidedAt, inv.void_reason AS voidReason, inv.version`
const INVOICE_FROM = `FROM invoices inv JOIN clients c ON c.id = inv.client_id JOIN users cu ON cu.id = inv.created_by`

const SORTABLE = { id: 'inv.id', number: 'inv.number', clientId: 'inv.client_id', clientName: 'c.name',
  period: 'inv.period', status: 'inv.status', total: 'inv.total', createdAt: 'inv.created_at' }

router.get('/', async (req, res) => {
  const q = req.query
  const { pageSize, offset, orderBy } = paging(q, SORTABLE, 'id')
  const where = []
  const params = []
  const clientIds = listParam(q.clientId)
  if (clientIds.length) { where.push('inv.client_id IN (?)'); params.push(clientIds) }
  const statuses = listParam(q.status, ['DRAFT', 'ISSUED', 'PAID', 'VOID'])
  if (statuses.length) { where.push('inv.status IN (?)'); params.push(statuses) }
  const periods = listParam(q.period)
  if (periods.length) { where.push('inv.period IN (?)'); params.push(periods) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows] = await pool.query(
    `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM} ${whereSql} ORDER BY ${orderBy}, inv.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset])
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${INVOICE_FROM} ${whereSql}`, params)
  res.json({ rows, total })
})

async function loadInvoice(db, id, lock = false) {
  const [[invoice]] = await db.query(
    `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM} WHERE inv.id = ?${lock ? ' FOR UPDATE' : ''}`, [id])
  if (!invoice) throw notFound(`Invoice ${id} not found`)
  return invoice
}

router.get('/:id', async (req, res) => {
  const invoice = await loadInvoice(pool, req.params.id)
  const [lines] = await pool.query(
    'SELECT position, kind, description, quantity, amount FROM invoice_lines WHERE invoice_id = ? ORDER BY position',
    [invoice.id])
  const [items] = await pool.query(
    `SELECT it.transaction_id AS transactionId, it.kind, t.trade_date AS tradeDate, t.settlement_date AS settlementDate,
       t.quantity, t.price, t.currency, it.gross, it.fx_rate AS fxRate, it.gross_eur AS grossEur, it.fee
     FROM invoice_items it JOIN transactions t ON t.id = it.transaction_id
     WHERE it.invoice_id = ? ORDER BY it.kind, t.settlement_date, it.transaction_id`,
    [invoice.id])
  res.json({ ...invoice, lines, items })
})

// Computes the invoice for client + period from current data (no writes).
async function calculate(conn, clientId, period) {
  const [[client]] = await conn.query('SELECT id, type FROM clients WHERE id = ?', [clientId])
  if (!client) throw notFound(`Client ${clientId} not found`)

  const start = `${period}-01`
  const [transactions] = await conn.query(
    `SELECT id, type, trade_date AS tradeDate, quantity, price, currency FROM transactions
     WHERE client_id = ? AND status = 'SETTLED' AND settlement_date >= ? AND settlement_date < (? + INTERVAL 1 MONTH)
     ORDER BY id`,
    [clientId, start, start])
  const [[{ active }]] = await conn.query(
    "SELECT COUNT(*) AS active FROM portfolios WHERE client_id = ? AND status = 'ACTIVE'", [clientId])

  // Fetch only the FX rates this invoice needs.
  const rateKeys = transactions.filter((t) => t.price !== null && t.currency !== feeSchedule.billingCurrency)
  const rates = new Map()
  if (rateKeys.length) {
    const [rows] = await conn.query(
      'SELECT rate_date AS d, currency AS c, eur_per_unit AS r FROM fx_rates WHERE (rate_date, currency) IN (?)',
      [rateKeys.map((t) => [t.tradeDate, t.currency])])
    for (const row of rows) rates.set(`${row.d}|${row.c}`, row.r)
  }

  try {
    return buildInvoice({
      transactions,
      schedule: feeSchedule,
      fxRate: (date, ccy) => rates.get(`${date}|${ccy}`) ?? null,
      clientType: client.type,
      hasActivePortfolio: Number(active) > 0,
    })
  } catch (err) {
    throw badRequest(`Cannot calculate invoice: ${err.message}`)
  }
}

async function writeContents(conn, invoiceId, calc) {
  await conn.query('DELETE FROM invoice_lines WHERE invoice_id = ?', [invoiceId])
  await conn.query('DELETE FROM invoice_items WHERE invoice_id = ?', [invoiceId])
  if (calc.lines.length) {
    await conn.query('INSERT INTO invoice_lines (invoice_id, position, kind, description, quantity, amount) VALUES ?',
      [calc.lines.map((l, i) => [invoiceId, i + 1, l.kind, l.description, l.quantity, money(l.amount)])])
  }
  if (calc.items.length) {
    await conn.query('INSERT INTO invoice_items (invoice_id, transaction_id, kind, gross, fx_rate, gross_eur, fee) VALUES ?',
      [calc.items.map((it) => [invoiceId, it.transactionId, it.kind, exact(it.gross), exact(it.fxRate),
        exact(it.grossEur), money(it.fee)])])
  }
}

const summarise = (calc) => ({
  total: money(calc.total),
  lines: calc.lines.map((l) => ({ kind: l.kind, quantity: l.quantity, amount: money(l.amount) })),
})

// Only months that are over can be billed: until then, more transactions may still settle.
function checkPeriod(period) {
  const now = new Date()
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  if (period >= current) throw badRequest(`Only completed months can be invoiced (${period} is not over yet)`)
}

const GenerateSchema = z.object({
  clientId: z.string().trim().min(1),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
})

router.post('/', requirePermission('invoice:generate'), async (req, res) => {
  const { clientId, period } = parse(GenerateSchema, req.body)
  checkPeriod(period)
  const invoice = await withTransaction(async (conn) => {
    const [[existing]] = await conn.query(
      "SELECT id, status FROM invoices WHERE client_id = ? AND period = ? AND status <> 'VOID' FOR UPDATE",
      [clientId, period])
    if (existing) {
      throw conflict(`Client ${clientId} already has a ${existing.status.toLowerCase()} invoice for ${period}`,
        { invoiceId: existing.id })
    }
    const calc = await calculate(conn, clientId, period)
    if (calc.lines.length === 0) {
      throw badRequest(`Nothing to invoice: no settled transactions in ${period} and no active portfolio`)
    }
    let id
    try {
      ;[{ insertId: id }] = await conn.query(
        'INSERT INTO invoices (client_id, period, status, currency, total, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [clientId, period, 'DRAFT', feeSchedule.billingCurrency, money(calc.total), req.user.id])
    } catch (err) {
      // Two operators generating at the same moment: the unique key lets exactly one win.
      if (err.code === 'ER_DUP_ENTRY') throw conflict(`Client ${clientId} already has an invoice for ${period}`)
      throw err
    }
    await writeContents(conn, id, calc)
    await audit(conn, { userId: req.user.id, entityType: 'INVOICE', entityId: String(id), clientId,
      action: 'GENERATED', changes: { period, ...summarise(calc) } })
    return loadInvoice(conn, id)
  })
  res.status(201).json(invoice)
})

// Recalculates a draft from current data (e.g. after more transactions were approved).
router.post('/:id/regenerate', requirePermission('invoice:generate'), async (req, res) => {
  const invoice = await withTransaction(async (conn) => {
    const inv = await loadInvoice(conn, req.params.id, true)
    if (inv.status !== 'DRAFT') throw conflict(`Only draft invoices can be recalculated (this one is ${inv.status})`)
    const calc = await calculate(conn, inv.clientId, inv.period)
    if (calc.lines.length === 0) throw badRequest('Nothing to invoice any more; void this draft instead')
    await conn.query('UPDATE invoices SET total = ?, version = version + 1 WHERE id = ?', [money(calc.total), inv.id])
    await writeContents(conn, inv.id, calc)
    await audit(conn, { userId: req.user.id, entityType: 'INVOICE', entityId: String(inv.id), clientId: inv.clientId,
      action: 'RECALCULATED', changes: { total: { from: inv.total, to: money(calc.total) } } })
    return loadInvoice(conn, inv.id)
  })
  res.json(invoice)
})

// Status changes: each one locks the invoice, checks the allowed source status, and is audited.
async function transition(req, { from, to, verb, action, extra = {}, check }) {
  return withTransaction(async (conn) => {
    const inv = await loadInvoice(conn, req.params.id, true)
    if (!from.includes(inv.status)) {
      throw conflict(`Cannot ${verb} an invoice that is ${inv.status}`)
    }
    if (check) await check(conn, inv)
    const sets = Object.keys(extra).map((k) => `${k} = ?`)
    await conn.query(`UPDATE invoices SET status = ?, ${[...sets, 'version = version + 1'].join(', ')} WHERE id = ?`,
      [to, ...Object.values(extra).map((v) => (typeof v === 'function' ? v(inv) : v)), inv.id])
    await audit(conn, { userId: req.user.id, entityType: 'INVOICE', entityId: String(inv.id), clientId: inv.clientId,
      action, changes: { status: { from: inv.status, to }, ...(req.body?.reason ? { reason: req.body.reason } : {}) } })
    return loadInvoice(conn, inv.id)
  })
}

router.post('/:id/issue', requirePermission('invoice:issue'), async (req, res) => {
  res.json(await transition(req, {
    from: ['DRAFT'], to: 'ISSUED', verb: 'issue', action: 'ISSUED',
    extra: {
      issued_at: new Date(),
      number: (inv) => `INV-${inv.period}-${String(inv.id).padStart(6, '0')}`,
    },
    // Refuse to issue a stale draft: once issued, the amounts can never change.
    check: async (conn, inv) => {
      const calc = await calculate(conn, inv.clientId, inv.period)
      if (money(calc.total) !== money(inv.total)) {
        throw conflict(`The draft is out of date (would now be EUR ${money(calc.total)}). Recalculate it before issuing.`)
      }
    },
  }))
})

router.post('/:id/pay', requirePermission('invoice:pay'), async (req, res) => {
  res.json(await transition(req, { from: ['ISSUED'], to: 'PAID', verb: 'mark as paid', action: 'PAID', extra: { paid_at: new Date() } }))
})

const VoidSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) })

router.post('/:id/void', requirePermission('invoice:void'), async (req, res) => {
  const { reason } = parse(VoidSchema, req.body)
  res.json(await transition(req, {
    from: ['DRAFT', 'ISSUED'], to: 'VOID', verb: 'void', action: 'VOIDED', extra: { voided_at: new Date(), void_reason: reason },
  }))
})

export default router
