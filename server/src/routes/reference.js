import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

// Small lookup lists the UI needs for filters and pickers.
router.get('/', async (req, res) => {
  const [users] = await pool.query('SELECT id, name, email, role FROM users ORDER BY name')
  const [countries] = await pool.query('SELECT DISTINCT country FROM clients ORDER BY country')
  const [currencies] = await pool.query('SELECT DISTINCT currency FROM instruments ORDER BY currency')
  res.json({
    users,
    countries: countries.map((r) => r.country),
    currencies: currencies.map((r) => r.currency),
    clientTypes: ['RETAIL', 'INSTITUTIONAL'],
    kycStatuses: ['APPROVED', 'PENDING', 'EXPIRED', 'REJECTED'],
    transactionTypes: ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT'],
    transactionStatuses: ['PENDING', 'SETTLED', 'CANCELLED', 'FAILED'],
    invoiceStatuses: ['DRAFT', 'ISSUED', 'PAID', 'VOID'],
  })
})

export default router
