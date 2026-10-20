import bcrypt from 'bcryptjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { dbConfig, withTransaction } from '../db.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(here, '../../../data')
const INITIAL_PASSWORD = 'Challenge-2026!'
const BATCH = 2000

// MySQL can take a while to accept connections on first boot (docker), so retry.
async function connectWithRetry(attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      return await mysql.createConnection({ ...dbConfig, multipleStatements: true })
    } catch (err) {
      if (i >= attempts) throw err
      console.log(`Waiting for MySQL (${err.code || err.message}), attempt ${i}/${attempts}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

async function migrate() {
  const conn = await connectWithRetry()
  try {
    await conn.query(await fs.readFile(path.join(here, 'schema.sql'), 'utf8'))
  } finally {
    await conn.end()
  }
}

async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, name), 'utf8'))
}

async function readCsv(name) {
  const lines = (await fs.readFile(path.join(DATA_DIR, name), 'utf8')).split(/\r?\n/).filter(Boolean)
  const header = lines.shift().split(',')
  // The seed CSVs are simple (no quoted fields), so a plain split is enough here.
  return lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [header[i], v])))
}

async function insertBatches(conn, sql, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await conn.query(sql, [rows.slice(i, i + BATCH)])
  }
}

async function seed() {
  await withTransaction(async (conn) => {
    // Lock the marker row so two server instances starting at once can't both seed.
    const [[seeded]] = await conn.query("SELECT meta_value FROM app_meta WHERE meta_key = 'seeded_at' FOR UPDATE")
    if (seeded) {
      console.log(`Data already loaded (${seeded.meta_value}), skipping seed`)
      return
    }
    console.log(`Seeding from ${DATA_DIR}`)

    const users = await readJson('users.json')
    const hash = await bcrypt.hash(INITIAL_PASSWORD, 12)
    await insertBatches(conn, 'INSERT INTO users (id, email, name, role, password_hash) VALUES ?',
      users.map((u) => [u.id, u.email.toLowerCase(), u.name, u.role, hash]))

    const clients = await readJson('clients.json')
    await insertBatches(conn,
      'INSERT INTO clients (id, name, type, country, kyc_status, email, phone, relationship_manager_id, onboarded_on) VALUES ?',
      clients.map((c) => [c.id, c.name, c.type, c.country, c.kycStatus, c.email, c.phone, c.relationshipManagerId, c.onboardedOn]))

    const portfolios = await readJson('portfolios.json')
    await insertBatches(conn, 'INSERT INTO portfolios (id, client_id, name, base_currency, status) VALUES ?',
      portfolios.map((p) => [p.id, p.clientId, p.name, p.baseCurrency, p.status]))

    const instruments = await readJson('instruments.json')
    await insertBatches(conn, 'INSERT INTO instruments (isin, name, type, currency) VALUES ?',
      instruments.map((i) => [i.isin, i.name, i.type, i.currency]))

    const fx = await readCsv('fx-rates.csv')
    await insertBatches(conn, 'INSERT INTO fx_rates (rate_date, currency, eur_per_unit) VALUES ?',
      fx.map((r) => [r.date, r.currency, r.eurPerUnit]))

    const txs = await readCsv('transactions.csv')
    await insertBatches(conn,
      `INSERT INTO transactions (id, external_ref, client_id, portfolio_id, isin, type, trade_date, settlement_date,
         quantity, price, currency, status) VALUES ?`,
      txs.map((t) => [t.id, t.externalRef, t.clientId, t.portfolioId, t.isin, t.type, t.tradeDate, t.settlementDate,
        t.quantity, t.price === '' ? null : t.price, t.currency, t.status]))

    await conn.query("INSERT INTO app_meta (meta_key, meta_value) VALUES ('seeded_at', ?)", [new Date().toISOString()])
    console.log(`Seeded ${users.length} users, ${clients.length} clients, ${portfolios.length} portfolios, ` +
      `${instruments.length} instruments, ${fx.length} FX rates, ${txs.length} transactions`)
  })
}

export async function setupDatabase() {
  await migrate()
  await seed()
}
