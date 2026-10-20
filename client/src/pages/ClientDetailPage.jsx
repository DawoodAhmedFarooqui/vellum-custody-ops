import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link as RouterLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api, qs } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorAlert, StatusChip } from '../components/common.jsx'
import { useToast } from '../components/Toast.jsx'
import { fmtDateTime, fmtMoney, fmtPeriod, titleCase } from '../format.js'
import { useReference } from '../useReference.js'
import { TransactionsGrid } from './TransactionsPage.jsx'

const TABS = [
  { path: '', label: 'Overview' },
  { path: 'portfolios', label: 'Portfolios' },
  { path: 'transactions', label: 'Transactions' },
  { path: 'invoices', label: 'Invoices' },
  { path: 'audit', label: 'Audit log' },
]

export default function ClientDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { data: client, error, isLoading } = useQuery({ queryKey: ['client', id], queryFn: () => api.get(`/api/clients/${id}`) })

  if (isLoading) return <CircularProgress />
  if (error) return <ErrorAlert error={error} />

  const base = `/clients/${id}`
  const current = TABS.find((t) => t.path && location.pathname.startsWith(`${base}/${t.path}`))?.path ?? ''

  return (
    <>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', mb: 1 }}>
        <Typography variant="h5">{client.name}</Typography>
        <Typography color="text.secondary">{client.id}</Typography>
        <Chip label={titleCase(client.type)} size="small" variant="outlined" />
        <StatusChip value={client.kycStatus} />
        <Typography variant="body2" color="text.secondary">RM: {client.relationshipManagerName}</Typography>
      </Stack>
      <Tabs value={current} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        {TABS.map((t) => <Tab key={t.path} value={t.path} label={t.label} component={RouterLink} to={t.path ? `${base}/${t.path}` : base} />)}
      </Tabs>
      <Outlet context={{ client }} />
    </>
  )
}

const FIELDS = ['name', 'type', 'country', 'kycStatus', 'email', 'phone', 'relationshipManagerId', 'onboardedOn']
const LABELS = { name: 'Name', type: 'Type', country: 'Country', kycStatus: 'KYC status', email: 'Email', phone: 'Phone',
  relationshipManagerId: 'Relationship manager', onboardedOn: 'Onboarded on' }
const toForm = (c) => Object.fromEntries(FIELDS.map((f) => [f, c[f] ?? '']))

export function ClientOverview() {
  const { client } = useOutletContext()
  const ref = useReference()
  // Wait for the pick lists so the selects never render with a value they don't know yet.
  if (!ref.users.length) return <CircularProgress />
  return <OverviewForm key={`${client.id}:${client.version}`} client={client} />
}

function OverviewForm({ client }) {
  const { can } = useAuth()
  const ref = useReference()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState(() => toForm(client))
  const [conflict, setConflict] = useState(null) // the other editor's version, from a 409
  const editable = can('client:edit')

  const save = useMutation({
    mutationFn: (version) => api.put(`/api/clients/${client.id}`, { ...form, relationshipManagerId: Number(form.relationshipManagerId), version }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['client', client.id], (old) => ({ ...old, ...updated }))
      queryClient.invalidateQueries({ queryKey: ['/api/clients'] })
      queryClient.invalidateQueries({ queryKey: ['audit', client.id] })
      setConflict(null)
      toast('Client saved')
    },
    onError: (err) => {
      if (err.status === 409 && err.details?.current) setConflict(err.details.current)
    },
  })

  const dirty = FIELDS.some((f) => String(form[f]) !== String(client[f] ?? ''))
  const field = (name, props = {}) => (
    <TextField fullWidth size="small" label={LABELS[name]} value={form[name]} disabled={!editable}
      onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      error={Boolean(save.error?.details?.fields?.[name])} helperText={save.error?.details?.fields?.[name]} {...props} />
  )
  const userName = (id) => ref.users.find((u) => u.id === Number(id))?.name || id

  return (
    <Paper sx={{ p: 3, maxWidth: 900 }} component="form" onSubmit={(e) => { e.preventDefault(); save.mutate(client.version) }}>
      {!editable && <Alert severity="info" sx={{ mb: 2 }}>Your role can view client details but not change them.</Alert>}
      {save.error?.status !== 409 && <ErrorAlert error={save.error} sx={{ mb: 2 }} onClose={() => save.reset()} />}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>{field('name')}</Grid>
        <Grid size={{ xs: 6, md: 3 }}>{field('type', { select: true, children: ref.clientTypes.map((t) => <MenuItem key={t} value={t}>{titleCase(t)}</MenuItem>) })}</Grid>
        <Grid size={{ xs: 6, md: 3 }}>{field('kycStatus', { select: true, children: ref.kycStatuses.map((t) => <MenuItem key={t} value={t}>{titleCase(t)}</MenuItem>) })}</Grid>
        <Grid size={{ xs: 12, md: 6 }}>{field('email', { type: 'email' })}</Grid>
        <Grid size={{ xs: 6, md: 3 }}>{field('phone')}</Grid>
        <Grid size={{ xs: 6, md: 3 }}>{field('country', { slotProps: { htmlInput: { maxLength: 2, style: { textTransform: 'uppercase' } } } })}</Grid>
        <Grid size={{ xs: 12, md: 6 }}>{field('relationshipManagerId', { select: true, children: ref.users.map((u) => <MenuItem key={u.id} value={u.id}>{u.name} ({titleCase(u.role)})</MenuItem>) })}</Grid>
        <Grid size={{ xs: 6, md: 3 }}>{field('onboardedOn', { type: 'date', slotProps: { inputLabel: { shrink: true } } })}</Grid>
      </Grid>
      <Stack direction="row" spacing={1} sx={{ mt: 3, alignItems: 'center' }}>
        {editable && <Button type="submit" variant="contained" disabled={!dirty || save.isPending}>Save</Button>}
        {editable && <Button onClick={() => setForm(toForm(client))} disabled={!dirty}>Reset</Button>}
        <span style={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Version {client.version} · last changed {fmtDateTime(client.updatedAt)} · {client.stats.portfolios} portfolios ({client.stats.activePortfolios} active) · {client.stats.transactions} transactions ({client.stats.pendingTransactions} pending)
        </Typography>
      </Stack>

      {/* Someone else saved first: show both versions and let the editor decide, nothing is overwritten silently. */}
      <Dialog open={Boolean(conflict)} maxWidth="md" fullWidth>
        <DialogTitle>This client was changed by someone else</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            While you were editing, the record was saved by another user (now version {conflict?.version}, {fmtDateTime(conflict?.updatedAt)}).
            Compare the fields below, then either take their version or overwrite it with yours.
          </Typography>
          <Table size="small">
            <TableHead><TableRow><TableCell>Field</TableCell><TableCell>Your value</TableCell><TableCell>Their value</TableCell></TableRow></TableHead>
            <TableBody>
              {conflict && FIELDS.filter((f) => String(form[f]) !== String(conflict[f] ?? '')).map((f) => (
                <TableRow key={f}>
                  <TableCell>{LABELS[f]}</TableCell>
                  <TableCell>{f === 'relationshipManagerId' ? userName(form[f]) : form[f]}</TableCell>
                  <TableCell>{f === 'relationshipManagerId' ? userName(conflict[f]) : conflict[f]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { queryClient.setQueryData(['client', client.id], (old) => ({ ...old, ...conflict })); setConflict(null); save.reset() }}>
            Take their version
          </Button>
          <Button variant="contained" color="warning" disabled={save.isPending} onClick={() => save.mutate(conflict.version)}>
            Overwrite with mine
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}

export function ClientPortfolios() {
  const { client } = useOutletContext()
  const { data, isLoading } = useQuery({ queryKey: ['portfolios', client.id], queryFn: () => api.get(`/api/clients/${client.id}/portfolios`) })
  if (isLoading) return <CircularProgress />
  return (
    <Paper sx={{ maxWidth: 900 }}>
      <Table size="small">
        <TableHead><TableRow><TableCell>ID</TableCell><TableCell>Name</TableCell><TableCell>Base currency</TableCell><TableCell>Status</TableCell><TableCell align="right">Transactions</TableCell><TableCell>Last trade</TableCell></TableRow></TableHead>
        <TableBody>
          {data.map((p) => (
            <TableRow key={p.id} hover>
              <TableCell>{p.id}</TableCell><TableCell>{p.name}</TableCell><TableCell>{p.baseCurrency}</TableCell>
              <TableCell><StatusChip value={p.status} /></TableCell>
              <TableCell align="right"><RouterLink to={`/clients/${client.id}/transactions${qs({ portfolioId: p.id })}`}>{p.transactions}</RouterLink></TableCell>
              <TableCell>{p.lastTradeDate || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  )
}

export function ClientTransactions() {
  const { client } = useOutletContext()
  return <TransactionsGrid clientId={client.id} height="calc(100vh - 330px)" />
}

export function ClientInvoices() {
  const { client } = useOutletContext()
  const { can } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState('2026-09')
  const { data, isLoading } = useQuery({ queryKey: ['/api/invoices', client.id], queryFn: () => api.get(`/api/invoices${qs({ clientId: client.id, sort: 'period', dir: 'desc', pageSize: 200 })}`) })

  const generate = useMutation({
    mutationFn: () => api.post('/api/invoices', { clientId: client.id, period }),
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] })
      queryClient.invalidateQueries({ queryKey: ['audit', client.id] })
      toast(`Draft invoice for ${fmtPeriod(period)} generated: ${fmtMoney(inv.total)}`)
      navigate(`/invoices/${inv.id}`)
    },
  })

  return (
    <Box sx={{ maxWidth: 900 }}>
      {can('invoice:generate') && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <TextField size="small" type="month" label="Month" value={period} onChange={(e) => setPeriod(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <Button variant="contained" onClick={() => generate.mutate()} disabled={!period || generate.isPending}>Generate invoice</Button>
            {generate.error?.status === 409 && generate.error.details?.invoiceId && (
              <Button component={RouterLink} to={`/invoices/${generate.error.details.invoiceId}`}>Open existing invoice</Button>
            )}
          </Stack>
          <ErrorAlert error={generate.error} sx={{ mt: 2 }} onClose={() => generate.reset()} />
        </Paper>
      )}
      <Paper>
        {isLoading ? <CircularProgress sx={{ m: 2 }} /> : (
          <Table size="small">
            <TableHead><TableRow><TableCell>Number</TableCell><TableCell>Month</TableCell><TableCell>Status</TableCell><TableCell align="right">Total</TableCell><TableCell>Created</TableCell><TableCell>By</TableCell></TableRow></TableHead>
            <TableBody>
              {data.rows.length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary" sx={{ p: 1 }}>No invoices yet.</Typography></TableCell></TableRow>}
              {data.rows.map((inv) => (
                <TableRow key={inv.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <TableCell>{inv.number || <em>draft #{inv.id}</em>}</TableCell>
                  <TableCell>{fmtPeriod(inv.period)}</TableCell>
                  <TableCell><StatusChip value={inv.status} /></TableCell>
                  <TableCell align="right">{fmtMoney(inv.total)}</TableCell>
                  <TableCell>{fmtDateTime(inv.createdAt)}</TableCell>
                  <TableCell>{inv.createdByName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  )
}

const ENTITY_LINK = {
  TRANSACTION: (e) => `/transactions${qs({ q: e.entityId })}`,
  INVOICE: (e) => `/invoices/${e.entityId}`,
}

function describeChange(key, value) {
  if (value && typeof value === 'object' && ('from' in value || 'to' in value)) {
    return <><b>{key}</b>: {String(value.from ?? '—')} → {String(value.to ?? '—')}</>
  }
  return <><b>{key}</b>: {typeof value === 'object' ? JSON.stringify(value) : String(value)}</>
}

export function ClientAudit() {
  const { client } = useOutletContext()
  const { data, isLoading } = useQuery({ queryKey: ['audit', client.id], queryFn: () => api.get(`/api/clients/${client.id}/audit`) })
  if (isLoading) return <CircularProgress />
  return (
    <Paper sx={{ maxWidth: 1100 }}>
      <Table size="small">
        <TableHead><TableRow><TableCell>When</TableCell><TableCell>Who</TableCell><TableCell>What</TableCell><TableCell>Action</TableCell><TableCell>Changes</TableCell></TableRow></TableHead>
        <TableBody>
          {data.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary" sx={{ p: 1 }}>No changes recorded yet.</Typography></TableCell></TableRow>}
          {data.map((e) => (
            <TableRow key={e.id} hover>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.at)}</TableCell>
              <TableCell>{e.userName || 'system'}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {titleCase(e.entityType)}{' '}
                {ENTITY_LINK[e.entityType] ? <RouterLink to={ENTITY_LINK[e.entityType](e)}>{e.entityId}</RouterLink> : e.entityId}
              </TableCell>
              <TableCell><StatusChip value={e.action} /></TableCell>
              <TableCell>
                {e.changes && Object.entries(e.changes).map(([k, v]) => <div key={k}>{describeChange(k, v)}</div>)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  )
}
