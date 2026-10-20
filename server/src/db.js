import mysql from 'mysql2/promise'

export const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'app',
  password: process.env.DB_PASSWORD || 'app',
  database: process.env.DB_NAME || 'app_db',
  // DATE/DATETIME come back as strings and DECIMAL as strings: no timezone shifts, no float money.
  dateStrings: true,
  decimalNumbers: false,
  timezone: 'Z',
}

export const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
})

// Runs fn inside a transaction and returns its result; rolls back on any error.
export async function withTransaction(fn) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
