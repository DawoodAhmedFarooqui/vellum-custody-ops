import { badRequest } from './errors.js'

export const MAX_PAGE_SIZE = 200

// Reads page/pageSize/sort/dir from the query string. Sort columns come from a whitelist,
// so user input never reaches SQL as an identifier.
export function paging(query, sortable, defaultSort) {
  const page = query.page === undefined || query.page === '' ? 0 : intParam(query.page, 'page')
  if (page > 1_000_000) throw badRequest('page is out of range')
  const pageSize = query.pageSize === undefined || query.pageSize === '' ? 50 : intParam(query.pageSize, 'pageSize')
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw badRequest(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`)
  const sortKey = query.sort || defaultSort
  const column = sortable[sortKey]
  if (!column) throw badRequest(`Cannot sort by "${sortKey}"`)
  const dir = String(query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC'
  return { page, pageSize, offset: page * pageSize, orderBy: `${column} ${dir}` }
}

// "a,b,c" or ['a','b'] -> ['a','b','c'], restricted to the allowed values.
export function listParam(value, allowed) {
  if (value === undefined || value === '') return []
  const items = (Array.isArray(value) ? value : String(value).split(',')).map((v) => v.trim()).filter(Boolean)
  if (allowed) {
    const bad = items.filter((v) => !allowed.includes(v))
    if (bad.length) throw badRequest(`Unknown filter value(s): ${bad.join(', ')}`)
  }
  return items
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
export function dateParam(value, name) {
  if (value === undefined || value === '') return null
  const m = ISO_DATE.exec(value)
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (!m || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw badRequest(`${name} must be a valid date in YYYY-MM-DD form`)
  }
  return value
}

// Positive integer query param (e.g. an import id), or null when absent.
export function intParam(value, name) {
  if (value === undefined || value === '') return null
  if (!/^\d+$/.test(String(value))) throw badRequest(`${name} must be a whole number`)
  return Number(value)
}

export const intListParam = (value, name) => listParam(value).map((v) => intParam(v, name))

// Escapes LIKE wildcards so a search for "50%" means the literal text.
export const likeContains = (s) => `%${s.replace(/[\\%_]/g, '\\$&')}%`
