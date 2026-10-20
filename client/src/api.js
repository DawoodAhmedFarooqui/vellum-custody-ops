// Thin fetch wrapper: JSON in/out, cookies included, errors carry status + details from the API.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`)
    this.status = status
    this.details = body?.details
  }
}

async function request(method, url, { body, form } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, { body }),
  put: (url, body) => request('PUT', url, { body }),
  upload: (url, form) => request('POST', url, { form }),
}

// Builds "?a=1&b=x,y" from an object, skipping empty values. Arrays become comma lists.
export function qs(params) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
