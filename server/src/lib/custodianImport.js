import Decimal from 'decimal.js'

// Parsing and validation of the custodian's monthly export. Pure functions: the route supplies
// the reference data, so this can be unit-tested without a database.

export const EXPECTED_HEADER = ['Referenz', 'Kunde', 'Depot', 'ISIN', 'Art', 'Handelstag', 'Valuta', 'Stueck', 'Kurs', 'Waehrung']
const TYPES = ['BUY', 'SELL', 'TRANSFER_IN', 'TRANSFER_OUT']

// Minimal RFC 4180-style parser for ';'-separated text with optional "quoted" fields ("" escapes a quote).
export function parseSemicolonCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  let i = 0
  let line = 1 // file line the current record starts on, as an editor shows it
  let startLine = 1
  const src = text.replace(/^﻿/, '')
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 2; continue }
      if (ch === '"') { quoted = false; i++; continue }
      if (ch === '\n' || (ch === '\r' && src[i + 1] !== '\n')) line++
      field += ch
      i++
      continue
    }
    if (ch === '"' && field.trim() === '') { quoted = true; field = ''; i++; continue }
    if (ch === ';') { row.push(field); field = ''; i++; continue }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      rows.push({ line: startLine, cells: row })
      row = []
      field = ''
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
      line++
      startLine = line
      continue
    }
    field += ch
    i++
  }
  if (field !== '' || row.length) { row.push(field); rows.push({ line: startLine, cells: row }) }
  // Drop blank lines; the header is line 1.
  return rows.filter((r) => !(r.cells.length === 1 && r.cells[0].trim() === ''))
}

// German number: "1.234,56" / "12.500" / "901" / "0,5". Thousands dots must be in groups of three.
const GERMAN_NUMBER = /^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/
export function parseGermanNumber(s) {
  if (!GERMAN_NUMBER.test(s)) return null
  return new Decimal(s.replace(/\./g, '').replace(',', '.'))
}

// "DD.MM.YYYY" -> "YYYY-MM-DD", or null if not a real calendar date.
export function parseGermanDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd))
  if (d.getUTCFullYear() !== +yyyy || d.getUTCMonth() !== +mm - 1 || d.getUTCDate() !== +dd) return null
  return `${yyyy}-${mm}-${dd}`
}

// ISIN check digit (ISO 6166): letters -> numbers (A=10 … Z=35), then Luhn over the digit string.
export function isValidIsin(isin) {
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return false
  const digits = isin.slice(0, 11).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i])
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11])
}

/**
 * Validates one data row. `ref` holds lookups: clients (Set), portfolios (Map id -> {clientId, status}),
 * instruments (Map isin -> {currency}). Returns { tx, errors }: all problems are collected, not just
 * the first, so ops can fix a row at the source in one go.
 */
export function validateRow(cells, ref) {
  const errors = []
  if (cells.length !== EXPECTED_HEADER.length) {
    return { tx: null, errors: [`Expected ${EXPECTED_HEADER.length} columns, found ${cells.length}`] }
  }
  // Agreed policy: stray whitespace is harmless and trimmed; everything else must match the spec exactly.
  const [externalRef, clientId, portfolioId, isin, type, tradeRaw, settleRaw, qtyRaw, priceRaw, currency] =
    cells.map((c) => c.trim())

  if (!externalRef) errors.push('Referenz is empty')
  else if (externalRef.length > 64) errors.push('Referenz is longer than 64 characters')

  if (!clientId) errors.push('Kunde is empty')
  else if (!ref.clients.has(clientId)) errors.push(`Unknown client "${clientId}"`)

  const portfolio = ref.portfolios.get(portfolioId)
  if (!portfolioId) errors.push('Depot is empty')
  else if (!portfolio) errors.push(`Unknown portfolio "${portfolioId}"`)
  else {
    if (clientId && portfolio.clientId !== clientId) {
      errors.push(`Portfolio ${portfolioId} belongs to ${portfolio.clientId}, not ${clientId || '(empty)'}`)
    }
    if (portfolio.status !== 'ACTIVE') errors.push(`Portfolio ${portfolioId} is ${portfolio.status}`)
  }

  const instrument = ref.instruments.get(isin)
  if (!isin) errors.push('ISIN is empty')
  else if (!isValidIsin(isin)) errors.push(`"${isin}" is not a valid ISIN (bad format or check digit)`)
  else if (!instrument) errors.push(`Unknown instrument ${isin}`)

  if (!TYPES.includes(type)) errors.push(`Unknown Art "${type}" (expected ${TYPES.join(', ')})`)

  const tradeDate = parseGermanDate(tradeRaw)
  if (!tradeDate) errors.push(`Handelstag "${tradeRaw}" is not a valid date (expected DD.MM.YYYY)`)
  const settlementDate = parseGermanDate(settleRaw)
  if (!settlementDate) errors.push(`Valuta "${settleRaw}" is not a valid date (expected DD.MM.YYYY)`)
  if (tradeDate && settlementDate && settlementDate < tradeDate) {
    errors.push(`Valuta ${settleRaw} is before Handelstag ${tradeRaw}`)
  }

  // Stored as DECIMAL(20,4) / DECIMAL(20,6): refuse what would be rounded or overflow rather than alter it silently.
  const fits = (d, intDigits, dp) => d.decimalPlaces() <= dp && d.abs().lt(new Decimal(10).pow(intDigits))
  const quantity = parseGermanNumber(qtyRaw)
  if (quantity === null) errors.push(`Stueck "${qtyRaw}" is not a valid positive number (e.g. 12.500 or 1.234,5)`)
  else if (quantity.lte(0)) errors.push('Stueck must be greater than 0')
  else if (!fits(quantity, 16, 4)) errors.push('Stueck has more than 4 decimal places or is too large')

  let price = null
  const isTransfer = type.startsWith('TRANSFER_')
  if (isTransfer) {
    if (priceRaw !== '') errors.push('Kurs must be empty for transfers')
  } else if (TYPES.includes(type)) {
    if (priceRaw === '') errors.push(`Kurs is required for ${type}`)
    else {
      price = parseGermanNumber(priceRaw)
      if (price === null) errors.push(`Kurs "${priceRaw}" is not a valid German number (e.g. 1.234,56)`)
      else if (price.lte(0)) errors.push('Kurs must be greater than 0')
      else if (!fits(price, 14, 6)) errors.push('Kurs has more than 6 decimal places or is too large')
    }
  }

  if (!currency) errors.push('Waehrung is empty')
  else if (instrument && currency !== instrument.currency) {
    errors.push(`Waehrung "${currency}" does not match the instrument's currency ${instrument.currency}`)
  } else if (!instrument && !ref.currencies.has(currency)) {
    errors.push(`Unknown currency "${currency}"`)
  }

  if (errors.length) return { tx: null, errors }
  return {
    tx: { externalRef, clientId, portfolioId, isin, type, tradeDate, settlementDate,
      quantity: quantity.toString(), price: price ? price.toString() : null, currency },
    errors,
  }
}

// True when two transactions describe the same economic event (used to recognise re-uploads).
export function sameTransaction(a, b) {
  const num = (v) => (v === null || v === undefined ? null : new Decimal(v).toString())
  return a.clientId === b.clientId && a.portfolioId === b.portfolioId && a.isin === b.isin && a.type === b.type &&
    a.tradeDate === b.tradeDate && a.settlementDate === b.settlementDate && a.currency === b.currency &&
    num(a.quantity) === num(b.quantity) && num(a.price) === num(b.price)
}
