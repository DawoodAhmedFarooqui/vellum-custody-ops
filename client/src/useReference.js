import { useQuery } from '@tanstack/react-query'
import { api } from './api.js'

const EMPTY = { users: [], countries: [], currencies: [], clientTypes: [], kycStatuses: [],
  transactionTypes: [], transactionStatuses: [], invoiceStatuses: [] }

// Lookup lists for filters and pickers; they change rarely, so cache them for the session.
export function useReference() {
  const { data } = useQuery({ queryKey: ['reference'], queryFn: () => api.get('/api/reference'), staleTime: Infinity })
  return data || EMPTY
}
