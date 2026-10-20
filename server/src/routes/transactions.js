import { Router } from 'express'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { pool, withTransaction } from '../db.js'
import { audit } from '../lib/audit.js'
import { requirePermission } from '../lib/auth.js'
import { parse } from '../lib/errors.js'
import { dateParam, intParam, likeContains, listParam, paging } from '../lib/listQuery.js'

const router = Router()

const TYPES = ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT']
const STATUSES = ['PENDING', 'SETTLED', 'CANCELLED', 'FAILED']

// DECIMAL columns arrive as strings like "482000.0000"; show them without trailing zeros.
const trimZeros = (v) => (v === null || v === undefined ? v : String(v).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''))
const tidy = (row) => ({ ...row, quantity: trimZeros(row.quantity), price: trimZeros(row.price), gross: trimZeros(row.gross) })

const COLUMNS = `t.id, t.external_ref AS externalRef, t.client_id AS clientId, c.name AS clientName,
  t.portfolio_id AS portfolioId, t.isin, i.name AS instrumentName, t.type, t.trade_date AS tradeDate,
  t.settlement_date AS settlementDate, t.quantity, t.price, t.quantity * t.price AS gross, t.currency,
  t.status, t.import_id AS importId, t.updated_at AS updatedAt`

const FROM = `FROM transactions t
  JOIN clients c ON c.id = t.client_id
  JOIN instruments i ON i.isin = t.isin`

const SORTABLE = {
  id: 't.id', externalRef: 't.external_ref', clientId: 't.client_id', clientName: 'c.name',
  portfolioId: 't.portfolio_id', isin: 't.isin', type: 't.type', tradeDate: 't.trade_date',
  settlementDate: 't.settlement_date', quantity: 't.quantity', price: 't.price', gross: 'gross',
  currency: 't.currency', status: 't.status',
}

// One filter definition shared by the grid, the CSV export and the client's Transactions tab,
// so the export is always exactly what the grid shows.
function buildFilter(q) {
  const where = []
  const params = []
  const inFilter = (column, values) => {
    if (values.length) {
      where.push(`${column} IN (?)`)
      params.push(values)
    }
  }
  const range = (column, from, to, name) => {
    const f = dateParam(from, `${name}From`)
    const t = dateParam(to, `${name}To`)
    if (f) { where.push(`${column} >= ?`); params.push(f) }
    if (t) { where.push(`${column} <= ?`); params.push(t) }
  }
  inFilter('t.client_id', listParam(q.clientId))
  inFilter('t.portfolio_id', listParam(q.portfolioId))
  inFilter('t.type', listParam(q.type, TYPES))
  inFilter('t.status', listParam(q.status, STATUSES))
  inFilter('t.currency', listParam(q.currency))
  range('t.trade_date', q.tradeFrom, q.tradeTo, 'trade')
  range('t.settlement_date', q.settleFrom, q.settleTo, 'settle')
  const importId = intParam(q.importId, 'importId')
  if (importId !== null) { where.push('t.import_id = ?'); params.push(importId) }
  if (q.q) {
    // Free text: exact ids/refs/ISINs, or part of the client or instrument name.
    const s = String(q.q).trim()
    where.push('(t.id = ? OR t.external_ref = ? OR t.isin = ? OR c.name LIKE ? OR i.name LIKE ?)')
    params.push(s.toUpperCase(), s, s.toUpperCase(), likeContains(s), likeContains(s))
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

router.get('/', async (req, res) => {
  const { pageSize, offset, orderBy } = paging(req.query, SORTABLE, 'tradeDate')
  const { whereSql, params } = buildFilter(req.query)
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} ${FROM} ${whereSql} ORDER BY ${orderBy}, t.id LIMIT ? OFFSET ?`,
    [...params, pageSize, offset])
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${FROM} ${whereSql}`, params)
  res.json({ rows: rows.map(tidy), total })
})

const EXPORT_FIELDS = ['id', 'externalRef', 'clientId', 'clientName', 'portfolioId', 'isin', 'instrumentName',
  'type', 'tradeDate', 'settlementDate', 'quantity', 'price', 'gross', 'currency', 'status']

function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  // Neutralise spreadsheet formulas (CSV injection) in text cells.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Streams the current view (same filters and sort as the grid, no paging) as CSV.
router.get('/export.csv', (req, res) => {
  const { orderBy } = paging(req.query, SORTABLE, 'tradeDate')
  const { whereSql, params } = buildFilter(req.query)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${stamp}.csv"`)
  res.write(`${EXPORT_FIELDS.join(',')}\r\n`)

  // pipeline() propagates backpressure from the HTTP response back to the DB row stream.
  const rows = pool.pool.query(`SELECT ${COLUMNS} ${FROM} ${whereSql} ORDER BY ${orderBy}, t.id`, params).stream()
  const toCsv = new Transform({
    objectMode: true,
    transform(row, _enc, done) {
      done(null, `${EXPORT_FIELDS.map((f) => csvCell(tidy(row)[f])).join(',')}\r\n`)
    },
  })
  pipeline(rows, toCsv, res).catch((err) => {
    console.error('CSV export failed', err)
    res.destroy(err)
  })
})

const BulkSchema = z.object({
  action: z.enum(['APPROVE', 'CANCEL']),
  ids: z.array(z.string().trim().min(1)).min(1).max(1000),
})

const TARGET = { APPROVE: 'SETTLED', CANCEL: 'CANCELLED' }

// Bulk status change. Only PENDING transactions move; every requested id gets its own outcome,
// so a mixed selection tells the operator exactly what happened to each one.
router.post('/bulk-status', requirePermission('transaction:status'), async (req, res) => {
  const { action, ids } = parse(BulkSchema, req.body)
  const unique = [...new Set(ids.map((id) => id.toUpperCase()))]
  const to = TARGET[action]

  const results = await withTransaction(async (conn) => {
    // Lock the rows so a concurrent approve/cancel of the same transaction waits and then sees the new status.
    const [rows] = await conn.query(
      'SELECT id, client_id AS clientId, status FROM transactions WHERE id IN (?) ORDER BY id FOR UPDATE', [unique])
    const byId = new Map(rows.map((r) => [r.id, r]))
    const pending = rows.filter((r) => r.status === 'PENDING')

    if (pending.length) {
      await conn.query("UPDATE transactions SET status = ? WHERE id IN (?) AND status = 'PENDING'",
        [to, pending.map((r) => r.id)])
      await audit(conn, pending.map((r) => ({
        userId: req.user.id, entityType: 'TRANSACTION', entityId: r.id, clientId: r.clientId,
        action: action === 'APPROVE' ? 'APPROVED' : 'CANCELLED',
        changes: { status: { from: 'PENDING', to } },
      })))
    }

    return unique.map((id) => {
      const row = byId.get(id)
      if (!row) return { id, outcome: 'NOT_FOUND', message: 'No such transaction' }
      if (row.status !== 'PENDING') {
        return { id, outcome: 'SKIPPED', from: row.status, message: `Not pending (status is ${row.status})` }
      }
      return { id, outcome: 'UPDATED', from: 'PENDING', to, message: `${action === 'APPROVE' ? 'Approved' : 'Cancelled'}` }
    })
  })

  const summary = { updated: 0, skipped: 0, notFound: 0 }
  for (const r of results) {
    if (r.outcome === 'UPDATED') summary.updated++
    else if (r.outcome === 'SKIPPED') summary.skipped++
    else summary.notFound++
  }
  res.json({ action, summary, results })
})

export default router
