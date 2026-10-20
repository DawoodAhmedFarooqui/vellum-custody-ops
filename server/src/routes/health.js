import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

router.get('/', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ api: 'ok', db: 'ok' })
  } catch (err) {
    res.status(503).json({ api: 'ok', db: `error: ${err.code || err.message}` })
  }
})

export default router
