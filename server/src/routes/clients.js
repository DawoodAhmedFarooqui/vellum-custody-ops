import { Router } from 'express'
import { z } from 'zod'
import { pool, withTransaction } from '../db.js'
import { audit, diff } from '../lib/audit.js'
import { requirePermission } from '../lib/auth.js'
import { badRequest, conflict, notFound, parse } from '../lib/errors.js'
import { likeContains, listParam, paging } from '../lib/listQuery.js'

const router = Router()

const CLIENT_COLUMNS = `c.id, c.name, c.type, c.country, c.kyc_status AS kycStatus, c.email, c.phone,
  c.relationship_manager_id AS relationshipManagerId, u.name AS relationshipManagerName,
  c.onboarded_on AS onboardedOn, c.version, c.updated_at AS updatedAt`

const SORTABLE = {
  id: 'c.id', name: 'c.name', type: 'c.type', country: 'c.country', kycStatus: 'c.kyc_status',
  relationshipManagerName: 'u.name', onboardedOn: 'c.onboarded_on',
}

router.get('/', async (req, res) => {
  const q = req.query
  const { pageSize, offset, orderBy } = paging(q, SORTABLE, 'id')
  const where = []
  const params = []
  const inFilter = (column, values) => {
    if (values.length) {
      where.push(`${column} IN (?)`)
      params.push(values)
    }
  }
  inFilter('c.type', listParam(q.type, ['RETAIL', 'INSTITUTIONAL']))
  inFilter('c.country', listParam(q.country))
  inFilter('c.kyc_status', listParam(q.kycStatus, ['APPROVED', 'PENDING', 'EXPIRED', 'REJECTED']))
  inFilter('c.relationship_manager_id', listParam(q.rm).map(Number))
  if (q.q) {
    // Name search; also matches an exact client id so "C-00042" finds that client.
    where.push('(c.name LIKE ? OR c.id = ?)')
    params.push(likeContains(String(q.q).trim()), String(q.q).trim().toUpperCase())
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const from = 'FROM clients c JOIN users u ON u.id = c.relationship_manager_id'

  const [rows] = await pool.query(
    `SELECT ${CLIENT_COLUMNS} ${from} ${whereSql} ORDER BY ${orderBy}, c.id LIMIT ? OFFSET ?`,
    [...params, pageSize, offset])
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} ${whereSql}`, params)
  res.json({ rows, total })
})

async function loadClient(db, id, lock = false) {
  const [[client]] = await db.query(
    `SELECT ${CLIENT_COLUMNS} FROM clients c JOIN users u ON u.id = c.relationship_manager_id WHERE c.id = ?${lock ? ' FOR UPDATE' : ''}`,
    [id])
  if (!client) throw notFound(`Client ${id} not found`)
  return client
}

router.get('/:id', async (req, res) => {
  const client = await loadClient(pool, req.params.id)
  const [[stats]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM portfolios WHERE client_id = ?) AS portfolios,
       (SELECT COUNT(*) FROM portfolios WHERE client_id = ? AND status = 'ACTIVE') AS activePortfolios,
       (SELECT COUNT(*) FROM transactions WHERE client_id = ?) AS transactions,
       (SELECT COUNT(*) FROM transactions WHERE client_id = ? AND status = 'PENDING') AS pendingTransactions`,
    [client.id, client.id, client.id, client.id])
  res.json({ ...client, stats })
})

const EDITABLE = ['name', 'type', 'country', 'kycStatus', 'email', 'phone', 'relationshipManagerId', 'onboardedOn']
const DB_COLUMN = {
  name: 'name', type: 'type', country: 'country', kycStatus: 'kyc_status', email: 'email', phone: 'phone',
  relationshipManagerId: 'relationship_manager_id', onboardedOn: 'onboarded_on',
}

const UpdateSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(255),
  type: z.enum(['RETAIL', 'INSTITUTIONAL']),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 code, e.g. DE'),
  kycStatus: z.enum(['APPROVED', 'PENDING', 'EXPIRED', 'REJECTED']),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(3).max(64).regex(/^[+0-9 ()/-]+$/, 'Only digits, spaces and + ( ) / -'),
  relationshipManagerId: z.number().int().positive(),
  onboardedOn: z.iso.date(),
})

// Optimistic locking: the update only applies if the row still has the version the editor
// started from. Otherwise 409 with the current record, so the UI can show what changed.
router.put('/:id', requirePermission('client:edit'), async (req, res) => {
  const input = parse(UpdateSchema, req.body)
  const updated = await withTransaction(async (conn) => {
    const current = await loadClient(conn, req.params.id, true)
    if (current.version !== input.version) {
      throw conflict('This client was changed by someone else since you opened it', { current })
    }
    const [[rm]] = await conn.query('SELECT id FROM users WHERE id = ?', [input.relationshipManagerId])
    if (!rm) throw badRequest('Invalid input', { fields: { relationshipManagerId: 'Unknown user' } })

    const changes = diff(current, input, EDITABLE)
    if (Object.keys(changes).length === 0) return current

    const sets = Object.keys(changes).map((f) => `${DB_COLUMN[f]} = ?`)
    await conn.query(
      `UPDATE clients SET ${sets.join(', ')}, version = version + 1 WHERE id = ? AND version = ?`,
      [...Object.keys(changes).map((f) => input[f]), current.id, input.version])
    await audit(conn, {
      userId: req.user.id, entityType: 'CLIENT', entityId: current.id, clientId: current.id,
      action: 'UPDATED', changes,
    })
    return loadClient(conn, current.id)
  })
  res.json(updated)
})

router.get('/:id/portfolios', async (req, res) => {
  await loadClient(pool, req.params.id)
  const [rows] = await pool.query(
    `SELECT p.id, p.name, p.base_currency AS baseCurrency, p.status,
       COUNT(t.id) AS transactions, MAX(t.trade_date) AS lastTradeDate
     FROM portfolios p LEFT JOIN transactions t ON t.portfolio_id = p.id
     WHERE p.client_id = ? GROUP BY p.id ORDER BY p.id`,
    [req.params.id])
  res.json(rows)
})

router.get('/:id/audit', async (req, res) => {
  await loadClient(pool, req.params.id)
  const [rows] = await pool.query(
    `SELECT a.id, a.at, a.entity_type AS entityType, a.entity_id AS entityId, a.action, a.changes,
       a.user_id AS userId, u.name AS userName
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.client_id = ? ORDER BY a.at DESC, a.id DESC LIMIT 1000`,
    [req.params.id])
  res.json(rows)
})

export default router
