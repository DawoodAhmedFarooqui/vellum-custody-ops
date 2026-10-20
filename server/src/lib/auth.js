import jwt from 'jsonwebtoken'
import { pool } from '../db.js'
import { HttpError } from './errors.js'

export const COOKIE_NAME = 'session'
const SESSION_HOURS = 10 // roughly one working day

const secret = process.env.JWT_SECRET || 'dev-only-secret-change-me'
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production')
}

// What each role may do. The UI reads the same list (via /api/auth/me) to hide actions,
// but this server-side check is the one that counts.
const PERMISSIONS = {
  VIEWER: [],
  OPERATOR: ['client:edit', 'transaction:status', 'invoice:generate', 'invoice:issue', 'import:run'],
  ADMIN: ['client:edit', 'transaction:status', 'invoice:generate', 'invoice:issue', 'import:run',
    'invoice:pay', 'invoice:void'],
}

export const permissionsFor = (role) => PERMISSIONS[role] || []

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, secret, { expiresIn: `${SESSION_HOURS}h` })
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict', // the cookie is never sent cross-site, which covers CSRF for this app
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_HOURS * 3600 * 1000,
  })
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME)
}

// Loads the user on every request so role changes and deleted users take effect immediately.
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) throw new HttpError(401, 'Not signed in')
  let payload
  try {
    payload = jwt.verify(token, secret)
  } catch {
    throw new HttpError(401, 'Session expired')
  }
  const [[user]] = await pool.query('SELECT id, email, name, role FROM users WHERE id = ?', [payload.sub])
  if (!user) throw new HttpError(401, 'Not signed in')
  req.user = user
  next()
}

export const requirePermission = (permission) => (req, res, next) => {
  if (!permissionsFor(req.user.role).includes(permission)) {
    throw new HttpError(403, `Your role (${req.user.role}) is not allowed to do this`)
  }
  next()
}
