import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isValidIsin, parseGermanDate, parseGermanNumber, parseSemicolonCsv, sameTransaction, validateRow,
} from '../src/lib/custodianImport.js'

const ref = {
  clients: new Set(['C-00001', 'C-00002']),
  portfolios: new Map([
    ['P-00001', { clientId: 'C-00001', status: 'ACTIVE' }],
    ['P-00002', { clientId: 'C-00001', status: 'CLOSED' }],
    ['P-00003', { clientId: 'C-00002', status: 'ACTIVE' }],
  ]),
  instruments: new Map([['ZZRTJVHZUUC8', { currency: 'EUR' }], ['ZZSY75GVWH38', { currency: 'USD' }]]),
  currencies: new Set(['EUR', 'USD', 'CHF', 'GBP']),
}
const row = (over = {}) => {
  const base = { ref: 'CST-1', kunde: 'C-00001', depot: 'P-00001', isin: 'ZZRTJVHZUUC8', art: 'BUY',
    hd: '21.09.2026', val: '23.09.2026', st: '1.234', kurs: '408,67', w: 'EUR', ...over }
  return [base.ref, base.kunde, base.depot, base.isin, base.art, base.hd, base.val, base.st, base.kurs, base.w]
}

test('parses BOM, CRLF, semicolons and quoted fields', () => {
  const rows = parseSemicolonCsv('﻿a;b;c\r\n1;"2,5";\r\n\r\n"x;""y""";z;w\r\n')
  assert.deepEqual(rows, [
    { line: 1, cells: ['a', 'b', 'c'] },
    { line: 2, cells: ['1', '2,5', ''] },
    { line: 4, cells: ['x;"y"', 'z', 'w'] },
  ])
})

test('German numbers', () => {
  assert.equal(parseGermanNumber('1.234,56').toString(), '1234.56')
  assert.equal(parseGermanNumber('12.500').toString(), '12500')
  assert.equal(parseGermanNumber('901').toString(), '901')
  assert.equal(parseGermanNumber('1,234.56'), null)
  assert.equal(parseGermanNumber('-28'), null)
  assert.equal(parseGermanNumber('12.50'), null) // thousands groups must have 3 digits
})

test('German dates must be real DD.MM.YYYY dates', () => {
  assert.equal(parseGermanDate('21.09.2026'), '2026-09-21')
  assert.equal(parseGermanDate('31.09.2026'), null)
  assert.equal(parseGermanDate('15/09/2026'), null)
  assert.equal(parseGermanDate('2026-09-14'), null)
})

test('ISIN check digit', () => {
  assert.equal(isValidIsin('ZZRTJVHZUUC8'), true)
  assert.equal(isValidIsin('US0378331005'), true) // Apple, a well-known valid ISIN
  assert.equal(isValidIsin('US0378331006'), false)
})

test('valid row normalises numbers and dates; whitespace is trimmed', () => {
  const { tx, errors } = validateRow(row({ kunde: '  C-00001 ', isin: ' ZZRTJVHZUUC8' }), ref)
  assert.deepEqual(errors, [])
  assert.deepEqual(tx, { externalRef: 'CST-1', clientId: 'C-00001', portfolioId: 'P-00001', isin: 'ZZRTJVHZUUC8',
    type: 'BUY', tradeDate: '2026-09-21', settlementDate: '2026-09-23', quantity: '1234', price: '408.67', currency: 'EUR' })
})

const errorsFor = (over) => validateRow(row(over), ref).errors.join(' | ')

test('rejects the kinds of problems seen in the custodian file', () => {
  assert.match(errorsFor({ ref: '' }), /Referenz is empty/)
  assert.match(errorsFor({ kunde: 'C-99999', depot: 'P-00003' }), /Unknown client/)
  assert.match(errorsFor({ depot: 'P-00003' }), /belongs to C-00002/)
  assert.match(errorsFor({ depot: 'P-00002' }), /is CLOSED/)
  assert.match(errorsFor({ isin: 'ZZRTJVHZUUC9' }), /not a valid ISIN/)
  assert.match(errorsFor({ art: 'KAUF' }), /Unknown Art "KAUF"/)
  assert.match(errorsFor({ val: '15/09/2026' }), /Valuta "15\/09\/2026" is not a valid date/)
  assert.match(errorsFor({ val: '20.09.2026' }), /before Handelstag/)
  assert.match(errorsFor({ st: '-28' }), /Stueck "-28"/)
  assert.match(errorsFor({ st: '0' }), /greater than 0/)
  assert.match(errorsFor({ kurs: '1,234.56' }), /Kurs "1,234.56"/)
  assert.match(errorsFor({ kurs: '' }), /Kurs is required/)
  assert.match(errorsFor({ art: 'TRANSFER_IN', kurs: '1,00' }), /must be empty for transfers/)
  assert.match(errorsFor({ w: 'usd' }), /does not match/)
  assert.match(errorsFor({ w: 'EURO' }), /does not match/)
  assert.match(errorsFor({ isin: 'ZZSY75GVWH38', w: 'EUR' }), /instrument's currency USD/)
})

test('re-upload detection compares the economic content', () => {
  const { tx } = validateRow(row(), ref)
  assert.equal(sameTransaction(tx, { ...tx, quantity: '1234.0000', price: '408.670000' }), true)
  assert.equal(sameTransaction(tx, { ...tx, price: '408.68' }), false)
})
