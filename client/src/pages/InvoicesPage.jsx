import { Link, Typography } from '@mui/material'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { ErrorAlert, StatusChip } from '../components/common.jsx'
import { FilterBar, MultiSelect } from '../components/filters.jsx'
import { ServerGrid, useServerRows } from '../components/ServerGrid.jsx'
import { fmtDateTime, fmtMoney, fmtPeriod } from '../format.js'
import { useReference } from '../useReference.js'
import { useUrlState } from '../useUrlState.js'

const DEFAULT_SORT = { field: 'createdAt', dir: 'desc' }

const columns = [
  { field: 'number', headerName: 'Number', width: 180, valueGetter: (v, row) => v || `draft #${row.id}` },
  { field: 'clientName', headerName: 'Client', flex: 1, minWidth: 200,
    renderCell: (p) => <Link component={RouterLink} to={`/clients/${p.row.clientId}`} onClick={(e) => e.stopPropagation()}>{p.value}</Link> },
  { field: 'period', headerName: 'Month', width: 150, valueFormatter: fmtPeriod },
  { field: 'status', headerName: 'Status', width: 110, renderCell: (p) => <StatusChip value={p.value} /> },
  { field: 'total', headerName: 'Total', width: 130, type: 'number', align: 'right', headerAlign: 'right', valueFormatter: fmtMoney },
  { field: 'createdAt', headerName: 'Created', width: 170, valueFormatter: fmtDateTime },
  { field: 'createdByName', headerName: 'By', width: 150, sortable: false },
]

export default function InvoicesPage() {
  const urlState = useUrlState()
  const ref = useReference()
  const navigate = useNavigate()
  const filters = { status: urlState.getList('status') }
  const { rows, total, isFetching, error } = useServerRows({ url: '/api/invoices', urlState, filters, defaultSort: DEFAULT_SORT })
  return (
    <>
      <Typography variant="h5" sx={{ mb: 1.5 }}>Invoices</Typography>
      <FilterBar hasFilters={filters.status.length > 0} onClear={() => urlState.set({ status: '' })}>
        <MultiSelect label="Status" value={filters.status} options={ref.invoiceStatuses} onChange={(v) => urlState.set({ status: v })} />
        <Typography variant="body2" color="text.secondary">Invoices are generated from a client's Invoices tab.</Typography>
      </FilterBar>
      <ErrorAlert error={error} sx={{ mb: 1 }} />
      <ServerGrid rows={rows} total={total} loading={isFetching} urlState={urlState} defaultSort={DEFAULT_SORT} columns={columns}
        onRowClick={(p) => navigate(`/invoices/${p.id}`)} />
    </>
  )
}
