const eur = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' })
const num = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 })

export const fmtMoney = (v) => (v === null || v === undefined || v === '' ? '' : eur.format(Number(v)))
export const fmtNumber = (v) => (v === null || v === undefined || v === '' ? '' : num.format(Number(v)))
// API datetimes are UTC "YYYY-MM-DD HH:MM:SS.mmm"; show them in the user's local time.
export const fmtDateTime = (v) => (v ? new Date(`${v.replace(' ', 'T')}Z`).toLocaleString('en-GB') : '')
export const fmtPeriod = (p) => (p ? new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '')
export const titleCase = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '')

export const STATUS_COLOR = {
  PENDING: 'warning', SETTLED: 'success', CANCELLED: 'default', FAILED: 'error',
  DRAFT: 'info', ISSUED: 'warning', PAID: 'success', VOID: 'default',
  APPROVED: 'success', EXPIRED: 'warning', REJECTED: 'error',
  ACTIVE: 'success', CLOSED: 'default',
  UPDATED: 'success', SKIPPED: 'warning', NOT_FOUND: 'error', IMPORTED: 'success', DUPLICATE: 'info', ERROR: 'error',
}
