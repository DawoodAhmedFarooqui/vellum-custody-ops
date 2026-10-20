import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { clearSession, issueSession, permissionsFor, requireAuth } from '../lib/auth.js'
import { HttpError, parse } from '../lib/errors.js'

const router = Router()

const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) })

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12)

// Simple in-memory brute-force brake: after 5 failures, an email is locked out for 5 minutes.
// Good enough for a single instance; multi-instance would need a shared store.
const failures = new Map()
const MAX_FAILURES = 5
const LOCK_MS = 5 * 60 * 1000

const toMe = (user) => ({ ...user, permissions: permissionsFor(user.role) })

router.post('/login', async (req, res) => {
  const { email, password } = parse(LoginSchema, req.body)
  const entry = failures.get(email)
  if (entry && entry.count >= MAX_FAILURES && Date.now() - entry.last < LOCK_MS) {
    throw new HttpError(429, 'Too many failed attempts, try again in a few minutes')
  }

  const [[user]] = await pool.query('SELECT id, email, name, role, password_hash FROM users WHERE email = ?', [email])
  const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH)
  if (!user || !ok) {
    failures.set(email, { count: (entry?.count || 0) + 1, last: Date.now() })
    throw new HttpError(401, 'Invalid email or password')
  }
  failures.delete(email)
  issueSession(res, user)
  const { password_hash: _, ...safe } = user
  res.json(toMe(safe))
})

router.post('/logout', (req, res) => {
  clearSession(res)
  res.status(204).end()
})

router.get('/me', requireAuth, (req, res) => {
  res.json(toMe(req.user))
})

export default router
