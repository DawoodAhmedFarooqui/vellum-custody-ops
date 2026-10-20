import { badRequest } from './errors.js'

export const MAX_PAGE_SIZE = 200

// Reads page/pageSize/sort/dir from the query string. Sort columns come from a whitelist,
// so user input never reaches SQL as an identifier.
export function paging(query, sortable, defaultSort) {
  const page = Math.max(0, Number.parseInt(query.page, 10) || 0)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.pageSize, 10) || 50))
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export function dateParam(value, name) {
  if (value === undefined || value === '') return null
  if (!ISO_DATE.test(value)) throw badRequest(`${name} must be YYYY-MM-DD`)
  return value
}

// Escapes LIKE wildcards so a search for "50%" means the literal text.
export const likeContains = (s) => `%${s.replace(/[\\%_]/g, '\\$&')}%`
