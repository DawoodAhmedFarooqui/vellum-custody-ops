import { Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { StatusChip } from '../components/common.jsx'
import { FilterBar, MultiSelect, SearchField } from '../components/filters.jsx'
import { ServerGrid, useServerRows } from '../components/ServerGrid.jsx'
import { titleCase } from '../format.js'
import { useReference } from '../useReference.js'
import { useUrlState } from '../useUrlState.js'

const DEFAULT_SORT = { field: 'id', dir: 'asc' }

const columns = [
  { field: 'id', headerName: 'ID', width: 100 },
  { field: 'name', headerName: 'Name', flex: 1, minWidth: 200 },
  { field: 'type', headerName: 'Type', width: 130, valueFormatter: titleCase },
  { field: 'country', headerName: 'Country', width: 90 },
  { field: 'kycStatus', headerName: 'KYC', width: 120, renderCell: (p) => <StatusChip value={p.value} /> },
  { field: 'relationshipManagerName', headerName: 'Relationship manager', width: 180 },
  { field: 'email', headerName: 'Email', width: 260, sortable: false },
  { field: 'onboardedOn', headerName: 'Onboarded', width: 120 },
]

export default function ClientsPage() {
  const urlState = useUrlState()
  const ref = useReference()
  const navigate = useNavigate()
  const filters = {
    q: urlState.get('q'), type: urlState.getList('type'), country: urlState.getList('country'),
    kycStatus: urlState.getList('kycStatus'), rm: urlState.getList('rm'),
  }
  const hasFilters = Object.values(filters).some((v) => (Array.isArray(v) ? v.length : v))
  const { rows, total, isFetching } = useServerRows({ url: '/api/clients', urlState, filters, defaultSort: DEFAULT_SORT })

  return (
    <>
      <Typography variant="h5" sx={{ mb: 1.5 }}>Clients</Typography>
      <FilterBar hasFilters={hasFilters} onClear={() => urlState.set({ q: '', type: '', country: '', kycStatus: '', rm: '' })}>
        <SearchField value={filters.q} onChange={(q) => urlState.set({ q })} placeholder="Search by name or ID" />
        <MultiSelect label="Type" value={filters.type} options={ref.clientTypes} onChange={(v) => urlState.set({ type: v })} width={140} />
        <MultiSelect label="Country" value={filters.country} options={ref.countries.map((c) => ({ value: c, label: c }))} onChange={(v) => urlState.set({ country: v })} width={130} />
        <MultiSelect label="KYC status" value={filters.kycStatus} options={ref.kycStatuses} onChange={(v) => urlState.set({ kycStatus: v })} />
        <MultiSelect label="Relationship manager" value={filters.rm} options={ref.users.map((u) => ({ value: u.id, label: u.name }))} onChange={(v) => urlState.set({ rm: v })} width={220} />
      </FilterBar>
      <ServerGrid rows={rows} total={total} loading={isFetching} urlState={urlState} defaultSort={DEFAULT_SORT} columns={columns}
        onRowClick={(p) => navigate(`/clients/${p.id}`)} />
    </>
  )
}
