import { createHash } from 'node:crypto'
import { Router } from 'express'
import multer from 'multer'
import { pool, withTransaction } from '../db.js'
import { audit } from '../lib/audit.js'
import { requirePermission } from '../lib/auth.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { EXPECTED_HEADER, parseSemicolonCsv, sameTransaction, validateRow } from '../lib/custodianImport.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })

const TX_FIELDS = `id, external_ref AS externalRef, client_id AS clientId, portfolio_id AS portfolioId, isin, type,
  trade_date AS tradeDate, settlement_date AS settlementDate, quantity, price, currency`

async function loadReferenceData(conn) {
  const [clients] = await conn.query('SELECT id FROM clients')
  const [portfolios] = await conn.query('SELECT id, client_id AS clientId, status FROM portfolios')
  const [instruments] = await conn.query('SELECT isin, currency FROM instruments')
  return {
    clients: new Set(clients.map((c) => c.id)),
    portfolios: new Map(portfolios.map((p) => [p.id, p])),
    instruments: new Map(instruments.map((i) => [i.isin, i])),
    currencies: new Set(instruments.map((i) => i.currency)),
  }
}

// Serialises imports: two uploads of the same file at the same moment must not both insert.
// The named lock lives on its own connection and is held until the import transaction has committed.
async function withImportLock(fn) {
  const lockConn = await pool.getConnection()
  try {
    const [[{ locked }]] = await lockConn.query("SELECT GET_LOCK('custodian_import', 10) AS locked")
    if (locked !== 1) throw conflict('Another import is running, try again in a moment')
    try {
      return await fn()
    } finally {
      await lockConn.query("SELECT RELEASE_LOCK('custodian_import')")
    }
  } finally {
    lockConn.release()
  }
}

router.post('/', requirePermission('import:run'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach the custodian CSV as "file"')
  const text = req.file.buffer.toString('utf8')
  const sha256 = createHash('sha256').update(req.file.buffer).digest('hex')
  const rows = parseSemicolonCsv(text)
  if (rows.length === 0) throw badRequest('The file is empty')

  const header = rows[0].cells.map((c) => c.trim())
  if (header.join(';') !== EXPECTED_HEADER.join(';')) {
    throw badRequest(`Unexpected header. Expected: ${EXPECTED_HEADER.join(';')}`, { found: header })
  }
  const dataRows = rows.slice(1)

  const result = await withImportLock(async () => withTransaction(async (conn) => {
    const ref = await loadReferenceData(conn)
    const [[previous]] = await conn.query(
      `SELECT i.id, i.uploaded_at AS uploadedAt, u.name AS uploadedBy FROM imports i JOIN users u ON u.id = i.uploaded_by
       WHERE i.sha256 = ? ORDER BY i.id LIMIT 1`, [sha256])

    // Validate every row; keep the first valid occurrence of each reference within the file.
    const results = []
    const accepted = new Map() // externalRef -> { line, tx }
    for (const { line, cells } of dataRows) {
      const { tx, errors } = validateRow(cells, ref)
      const refText = cells[0]?.trim() || null
      if (!tx) { results.push({ line, externalRef: refText, outcome: 'ERROR', errors }); continue }
      const first = accepted.get(tx.externalRef)
      if (first) {
        results.push(sameTransaction(first.tx, tx)
          ? { line, externalRef: tx.externalRef, outcome: 'DUPLICATE', message: `Same as line ${first.line} in this file` }
          : { line, externalRef: tx.externalRef, outcome: 'ERROR',
            errors: [`Referenz also used on line ${first.line} with different data`] })
        continue
      }
      accepted.set(tx.externalRef, { line, tx })
      results.push({ line, externalRef: tx.externalRef, outcome: 'PENDING_INSERT', tx })
    }

    // References that already exist: an identical transaction means "already imported" (re-upload);
    // different data under the same reference is a conflict ops must resolve with the custodian.
    const refs = [...accepted.keys()]
    const existing = new Map()
    if (refs.length) {
      const [found] = await conn.query(`SELECT ${TX_FIELDS} FROM transactions WHERE external_ref IN (?)`, [refs])
      for (const t of found) existing.set(t.externalRef, t)
    }

    const [[{ maxId }]] = await conn.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(id, 3) AS UNSIGNED)), 0) AS maxId FROM transactions WHERE id LIKE 'T-%'")
    let nextId = Number(maxId)
    const toInsert = []
    for (const r of results) {
      if (r.outcome !== 'PENDING_INSERT') continue
      const old = existing.get(r.externalRef)
      if (old) {
        Object.assign(r, sameTransaction(old, r.tx)
          ? { outcome: 'DUPLICATE', transactionId: old.id, message: `Already imported as ${old.id}` }
          : { outcome: 'ERROR', errors: [`Referenz already used by ${old.id} with different data`] })
      } else {
        nextId += 1
        r.transactionId = `T-${String(nextId).padStart(6, '0')}`
        r.outcome = 'IMPORTED'
        toInsert.push(r)
      }
      delete r.tx
    }

    const counts = {
      total: results.length,
      imported: toInsert.length,
      duplicates: results.filter((r) => r.outcome === 'DUPLICATE').length,
      errors: results.filter((r) => r.outcome === 'ERROR').length,
    }
    const [{ insertId: importId }] = await conn.query(
      `INSERT INTO imports (filename, sha256, uploaded_by, total_rows, imported_rows, duplicate_rows, error_rows, results)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.file.originalname, sha256, req.user.id, counts.total, counts.imported, counts.duplicates, counts.errors,
        JSON.stringify(results)])

    if (toInsert.length) {
      const txs = toInsert.map((r) => ({ id: r.transactionId, ...accepted.get(r.externalRef).tx }))
      await conn.query(
        `INSERT INTO transactions (id, external_ref, client_id, portfolio_id, isin, type, trade_date, settlement_date,
           quantity, price, currency, status, import_id) VALUES ?`,
        [txs.map((t) => [t.id, t.externalRef, t.clientId, t.portfolioId, t.isin, t.type, t.tradeDate,
          t.settlementDate, t.quantity, t.price, t.currency, 'PENDING', importId])])
      await audit(conn, txs.map((t) => ({
        userId: req.user.id, entityType: 'TRANSACTION', entityId: t.id, clientId: t.clientId, action: 'IMPORTED',
        changes: { importId, externalRef: t.externalRef, status: { from: null, to: 'PENDING' } },
      })))
    }

    return { id: importId, filename: req.file.originalname, counts, results,
      previousUpload: previous || null }
  }))
  res.status(201).json(result)
})

router.get('/', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT i.id, i.filename, i.uploaded_at AS uploadedAt, u.name AS uploadedBy, i.total_rows AS total,
       i.imported_rows AS imported, i.duplicate_rows AS duplicates, i.error_rows AS errors
     FROM imports i JOIN users u ON u.id = i.uploaded_by ORDER BY i.id DESC LIMIT 100`)
  res.json(rows)
})

router.get('/:id', async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT i.id, i.filename, i.sha256, i.uploaded_at AS uploadedAt, u.name AS uploadedBy, i.total_rows AS total,
       i.imported_rows AS imported, i.duplicate_rows AS duplicates, i.error_rows AS errors, i.results
     FROM imports i JOIN users u ON u.id = i.uploaded_by WHERE i.id = ?`, [req.params.id])
  if (!row) throw notFound(`Import ${req.params.id} not found`)
  const { total, imported, duplicates, errors, results, sha256, ...rest } = row
  // The first upload of the same file, if this one was a re-upload.
  const [[previousUpload]] = await pool.query(
    `SELECT i.id, i.uploaded_at AS uploadedAt, u.name AS uploadedBy FROM imports i JOIN users u ON u.id = i.uploaded_by
     WHERE i.sha256 = ? AND i.id < ? ORDER BY i.id LIMIT 1`, [sha256, row.id])
  res.json({ ...rest, counts: { total, imported, duplicates, errors }, results, previousUpload: previousUpload || null })
})

export default router
