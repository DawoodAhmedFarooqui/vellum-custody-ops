import CancelIcon from '@mui/icons-material/Cancel'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DownloadIcon from '@mui/icons-material/Download'
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ConfirmDialog, ErrorAlert, StatusChip } from '../components/common.jsx'
import { DateField, FilterBar, MultiSelect, SearchField } from '../components/filters.jsx'
import { ServerGrid, useServerRows } from '../components/ServerGrid.jsx'
import { useToast } from '../components/Toast.jsx'
import { fmtNumber, titleCase } from '../format.js'
import { useReference } from '../useReference.js'
import { useUrlState } from '../useUrlState.js'

const DEFAULT_SORT = { field: 'tradeDate', dir: 'desc' }
const numCol = { type: 'number', align: 'right', headerAlign: 'right', valueFormatter: fmtNumber }

const ACTIONS = {
  APPROVE: { label: 'Approve', done: 'approved', to: 'SETTLED', color: 'success', icon: <CheckCircleIcon /> },
  CANCEL: { label: 'Cancel', done: 'cancelled', to: 'CANCELLED', color: 'error', icon: <CancelIcon /> },
}

function makeColumns({ withClient }) {
  return [
    { field: 'id', headerName: 'ID', width: 95 },
    ...(withClient ? [{
      field: 'clientName', headerName: 'Client', width: 200,
      renderCell: (p) => <Link component={RouterLink} to={`/clients/${p.row.clientId}`} onClick={(e) => e.stopPropagation()}>{p.value}</Link>,
    }] : []),
    { field: 'portfolioId', headerName: 'Portfolio', width: 95 },
    { field: 'isin', headerName: 'ISIN', width: 125 },
    { field: 'instrumentName', headerName: 'Instrument', width: 190, sortable: false },
    { field: 'type', headerName: 'Type', width: 115, valueFormatter: titleCase },
    { field: 'tradeDate', headerName: 'Trade date', width: 105 },
    { field: 'settlementDate', headerName: 'Settlement', width: 105 },
    { field: 'quantity', headerName: 'Quantity', width: 100, ...numCol },
    { field: 'price', headerName: 'Price', width: 95, ...numCol },
    { field: 'gross', headerName: 'Gross', width: 130, ...numCol },
    { field: 'currency', headerName: 'Ccy', width: 60 },
    { field: 'status', headerName: 'Status', width: 110, renderCell: (p) => <StatusChip value={p.value} /> },
    { field: 'externalRef', headerName: 'Custodian ref', width: 230 },
  ]
}

// Shared by the Transactions page and the client's Transactions tab (clientId fixed).
export function TransactionsGrid({ clientId, height }) {
  const urlState = useUrlState()
  const ref = useReference()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(new Set())
  const [pending, setPending] = useState(null) // action awaiting confirmation
  const [outcome, setOutcome] = useState(null) // result of the last bulk action

  const filters = {
    q: urlState.get('q'), type: urlState.getList('type'), status: urlState.getList('status'),
    currency: urlState.getList('currency'), tradeFrom: urlState.get('tradeFrom'), tradeTo: urlState.get('tradeTo'),
    settleFrom: urlState.get('settleFrom'), settleTo: urlState.get('settleTo'),
    portfolioId: urlState.get('portfolioId'), importId: urlState.get('importId'),
  }
  const hasFilters = Object.values(filters).some((v) => (Array.isArray(v) ? v.length : v))
  const fixed = clientId ? { clientId } : {}
  const { rows, total, isFetching, query, error } = useServerRows({ url: '/api/transactions', urlState, filters, fixed, defaultSort: DEFAULT_SORT })

  const bulk = useMutation({
    mutationFn: ({ action, ids }) => api.post('/api/transactions/bulk-status', { action, ids }),
    onSuccess: (data) => {
      setPending(null)
      setSelected(new Set())
      setOutcome(data)
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] })
      queryClient.invalidateQueries({ queryKey: ['client'] })
      const { updated, skipped, notFound } = data.summary
      toast(`${updated} ${ACTIONS[data.action].done}` + (skipped + notFound ? `, ${skipped + notFound} unchanged` : ''),
        updated ? 'success' : 'warning')
    },
  })

  const ids = [...selected]
  return (
    <>
      <FilterBar hasFilters={hasFilters} onClear={() => urlState.set(Object.fromEntries(Object.keys(filters).map((k) => [k, ''])))}>
        <SearchField value={filters.q} onChange={(q) => urlState.set({ q })} placeholder={clientId ? 'ID, ref, ISIN, instrument' : 'ID, ref, ISIN, client, instrument'} />
        <MultiSelect label="Status" value={filters.status} options={ref.transactionStatuses} onChange={(v) => urlState.set({ status: v })} width={150} />
        <MultiSelect label="Type" value={filters.type} options={ref.transactionTypes} onChange={(v) => urlState.set({ type: v })} width={150} />
        <MultiSelect label="Currency" value={filters.currency} options={ref.currencies.map((c) => ({ value: c, label: c }))} onChange={(v) => urlState.set({ currency: v })} width={120} />
        <DateField label="Trade from" value={filters.tradeFrom} onChange={(v) => urlState.set({ tradeFrom: v })} />
        <DateField label="Trade to" value={filters.tradeTo} onChange={(v) => urlState.set({ tradeTo: v })} />
        <DateField label="Settle from" value={filters.settleFrom} onChange={(v) => urlState.set({ settleFrom: v })} />
        <DateField label="Settle to" value={filters.settleTo} onChange={(v) => urlState.set({ settleTo: v })} />
        {filters.portfolioId && <Chip label={`Portfolio ${filters.portfolioId}`} onDelete={() => urlState.set({ portfolioId: '' })} size="small" />}
        {filters.importId && <Chip label={`Import #${filters.importId}`} onDelete={() => urlState.set({ importId: '' })} size="small" />}
      </FilterBar>

      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
        {can('transaction:status') && (
          <>
            <Button size="small" variant="contained" color="success" startIcon={ACTIONS.APPROVE.icon} disabled={!ids.length} onClick={() => setPending('APPROVE')}>
              Approve
            </Button>
            <Button size="small" variant="outlined" color="error" startIcon={ACTIONS.CANCEL.icon} disabled={!ids.length} onClick={() => setPending('CANCEL')}>
              Cancel
            </Button>
            <Typography variant="body2" color="text.secondary">
              {ids.length ? `${ids.length} selected (only pending ones will change)` : 'Select transactions to approve or cancel them'}
            </Typography>
          </>
        )}
        <span style={{ flex: 1 }} />
        <Typography variant="body2" color="text.secondary">{total.toLocaleString('en-GB')} transactions</Typography>
        <Button size="small" startIcon={<DownloadIcon />} component="a" href={`/api/transactions/export.csv${query}`} download>
          Export CSV
        </Button>
      </Stack>

      <ErrorAlert error={error} sx={{ mb: 1 }} />
      <ServerGrid rows={rows} total={total} loading={isFetching} urlState={urlState} defaultSort={DEFAULT_SORT}
        columns={makeColumns({ withClient: !clientId })} height={height}
        checkboxSelection={can('transaction:status')}
        isRowSelectable={(p) => p.row.status === 'PENDING'}
        rowSelectionModel={{ type: 'include', ids: selected }}
        onRowSelectionModelChange={(m) => setSelected(m.type === 'include' ? new Set(m.ids) : new Set())}
        initialState={{ columns: { columnVisibilityModel: { externalRef: false } } }} />

      <ConfirmDialog open={Boolean(pending)} onClose={() => setPending(null)} busy={bulk.isPending}
        title={`${ACTIONS[pending]?.label} ${ids.length} transaction${ids.length === 1 ? '' : 's'}?`}
        text={`Pending transactions become ${titleCase(ACTIONS[pending]?.to)}. Any that are no longer pending are left unchanged and reported.`}
        confirmLabel={ACTIONS[pending]?.label} color={ACTIONS[pending]?.color}
        onConfirm={() => bulk.mutate({ action: pending, ids })}>
        <ErrorAlert error={bulk.error} sx={{ mt: 2 }} />
      </ConfirmDialog>

      <BulkOutcomeDialog outcome={outcome} onClose={() => setOutcome(null)} />
    </>
  )
}

// Row-by-row result of a bulk action, so a mixed selection is fully explained.
function BulkOutcomeDialog({ outcome, onClose }) {
  if (!outcome) return null
  const { summary, results, action } = outcome
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{ACTIONS[action].label}: {summary.updated} updated, {summary.skipped} skipped{summary.notFound ? `, ${summary.notFound} not found` : ''}</DialogTitle>
      <DialogContent dividers sx={{ p: 0, maxHeight: 420 }}>
        <Table size="small" stickyHeader>
          <TableHead><TableRow><TableCell>Transaction</TableCell><TableCell>Outcome</TableCell><TableCell>Detail</TableCell></TableRow></TableHead>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.id}</TableCell>
                <TableCell><StatusChip value={r.outcome} /></TableCell>
                <TableCell>{r.outcome === 'UPDATED' ? `${titleCase(r.from)} → ${titleCase(r.to)}` : r.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  )
}

export default function TransactionsPage() {
  return (
    <>
      <Typography variant="h5" sx={{ mb: 1.5 }}>Transactions</Typography>
      <TransactionsGrid />
    </>
  )
}
