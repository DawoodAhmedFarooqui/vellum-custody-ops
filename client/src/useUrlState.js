import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

// Grid state (page, sort, filters, search) lives in the URL, so a copied link reopens the same view.
export function useUrlState(defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams()

  const get = (key) => searchParams.get(key) ?? defaults[key] ?? ''
  const getList = (key) => (searchParams.get(key) || '').split(',').filter(Boolean)

  const set = useCallback((patch, { resetPage = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        const value = Array.isArray(v) ? v.join(',') : v
        if (value === undefined || value === null || value === '' || value === defaults[k]) next.delete(k)
        else next.set(k, String(value))
      }
      if (resetPage && !('page' in patch)) next.delete('page')
      return next
    })
  }, [setSearchParams, defaults])

  const clear = useCallback(() => setSearchParams(new URLSearchParams()), [setSearchParams])

  return { get, getList, set, clear, params: Object.fromEntries(searchParams.entries()) }
}
