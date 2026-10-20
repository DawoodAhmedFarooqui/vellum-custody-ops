import cookieParser from 'cookie-parser'
import express from 'express'
import { requireAuth } from './lib/auth.js'
import authRouter from './routes/auth.js'
import clientsRouter from './routes/clients.js'
import healthRouter from './routes/health.js'
import importsRouter from './routes/imports.js'
import invoicesRouter from './routes/invoices.js'
import referenceRouter from './routes/reference.js'
import transactionsRouter from './routes/transactions.js'

const app = express()

// The UI is served from the same origin (Vite proxy in dev, nginx in docker), so no CORS is needed.
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.use('/api/health', healthRouter)
app.use('/api/auth', authRouter)

// Everything below requires a signed-in user; write routes additionally check permissions.
app.use('/api', requireAuth)
app.use('/api/reference', referenceRouter)
app.use('/api/clients', clientsRouter)
app.use('/api/transactions', transactionsRouter)
app.use('/api/invoices', invoicesRouter)
app.use('/api/imports', importsRouter)

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') err.status = 413
  const status = err.status || err.statusCode || 500
  if (status >= 500) console.error(err)
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message,
    ...(err.details ? { details: err.details } : {}),
  })
})

export default app
