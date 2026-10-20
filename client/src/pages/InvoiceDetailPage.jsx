import { Alert, Box, Button, CircularProgress, Collapse, Paper, Stack, Table, TableBody, TableCell, TableFooter, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ConfirmDialog, ErrorAlert, StatusChip } from '../components/common.jsx'
import { useToast } from '../components/Toast.jsx'
import { fmtDateTime, fmtMoney, fmtNumber, fmtPeriod, titleCase } from '../format.js'

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [showItems, setShowItems] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const [reason, setReason] = useState('')
  const { data: inv, error, isLoading } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get(`/api/invoices/${id}`) })

  const act = useMutation({
    mutationFn: ({ action, body }) => api.post(`/api/invoices/${id}/${action}`, body),
    onSuccess: (updated, { action }) => {
      queryClient.setQueryData(['invoice', id], (old) => ({ ...old, ...updated }))
      queryClient.invalidateQueries({ queryKey: ['invoice', id] })
      queryClient.invalidateQueries({ queryKey: ['/api/invoices'] })
      queryClient.invalidateQueries({ queryKey: ['audit'] })
      setVoidOpen(false)
      toast({ issue: 'Invoice issued', pay: 'Invoice marked as paid', void: 'Invoice voided', regenerate: 'Invoice recalculated' }[action])
    },
  })

  if (isLoading) return <CircularProgress />
  if (error) return <ErrorAlert error={error} />

  const busy = act.isPending
  const timeline = [['Created', inv.createdAt, inv.createdByName], ['Issued', inv.issuedAt], ['Paid', inv.paidAt], ['Voided', inv.voidedAt]]

  return (
    <Box sx={{ maxWidth: 1000 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', mb: 1 }}>
        <Typography variant="h5">{inv.number || `Draft invoice #${inv.id}`}</Typography>
        <StatusChip value={inv.status} size="medium" />
        <Typography color="text.secondary">
          <RouterLink to={`/clients/${inv.clientId}/invoices`}>{inv.clientName}</RouterLink> · {fmtPeriod(inv.period)}
        </Typography>
      </Stack>
      <ErrorAlert error={act.error} sx={{ mb: 2 }} onClose={() => act.reset()} />
      {inv.status === 'VOID' && <Alert severity="warning" sx={{ mb: 2 }}>Voided {fmtDateTime(inv.voidedAt)}: {inv.voidReason}</Alert>}

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        {inv.status === 'DRAFT' && can('invoice:generate') && <Button variant="outlined" disabled={busy} onClick={() => act.mutate({ action: 'regenerate' })}>Recalculate</Button>}
        {inv.status === 'DRAFT' && can('invoice:issue') && <Button variant="contained" disabled={busy} onClick={() => act.mutate({ action: 'issue' })}>Issue</Button>}
        {inv.status === 'ISSUED' && can('invoice:pay') && <Button variant="contained" color="success" disabled={busy} onClick={() => act.mutate({ action: 'pay' })}>Mark as paid</Button>}
        {['DRAFT', 'ISSUED'].includes(inv.status) && can('invoice:void') && <Button variant="outlined" color="error" disabled={busy} onClick={() => setVoidOpen(true)}>Void</Button>}
        {inv.status === 'ISSUED' && <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>Issued invoices cannot be changed.</Typography>}
      </Stack>

      <Paper sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>#</TableCell><TableCell>Description</TableCell><TableCell align="right">Transactions</TableCell><TableCell align="right">Amount ({inv.currency})</TableCell></TableRow></TableHead>
          <TableBody>
            {inv.lines.map((l) => (
              <TableRow key={l.position}>
                <TableCell>{l.position}</TableCell><TableCell>{l.description}</TableCell>
                <TableCell align="right">{l.kind === 'ACCOUNT_FEE' ? '' : l.quantity}</TableCell>
                <TableCell align="right">{fmtMoney(l.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} sx={{ fontWeight: 700, fontSize: '1rem', color: 'text.primary' }}>Total</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700, fontSize: '1rem', color: 'text.primary' }}>{fmtMoney(inv.total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Paper>

      <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
        {timeline.filter(([, at]) => at).map(([label, at, who]) => (
          <Typography key={label} variant="body2" color="text.secondary">{label} {fmtDateTime(at)}{who ? ` by ${who}` : ''}</Typography>
        ))}
      </Stack>

      <Button size="small" onClick={() => setShowItems(!showItems)}>{showItems ? 'Hide' : 'Show'} fee breakdown ({inv.items.length} transactions)</Button>
      <Collapse in={showItems}>
        <Paper sx={{ mt: 1 }}>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>Transaction</TableCell><TableCell>Type</TableCell><TableCell>Trade date</TableCell><TableCell>Settled</TableCell>
              <TableCell align="right">Quantity</TableCell><TableCell align="right">Price</TableCell><TableCell>Ccy</TableCell>
              <TableCell align="right">Gross</TableCell><TableCell align="right">FX (trade date)</TableCell><TableCell align="right">Gross EUR</TableCell><TableCell align="right">Fee</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {inv.items.map((it) => (
                <TableRow key={it.transactionId} hover>
                  <TableCell><RouterLink to={`/transactions?q=${it.transactionId}`}>{it.transactionId}</RouterLink></TableCell>
                  <TableCell>{titleCase(it.kind)}</TableCell><TableCell>{it.tradeDate}</TableCell><TableCell>{it.settlementDate}</TableCell>
                  <TableCell align="right">{fmtNumber(it.quantity)}</TableCell><TableCell align="right">{fmtNumber(it.price)}</TableCell><TableCell>{it.currency}</TableCell>
                  <TableCell align="right">{fmtNumber(it.gross)}</TableCell><TableCell align="right">{it.fxRate ? fmtNumber(it.fxRate) : ''}</TableCell>
                  <TableCell align="right">{it.grossEur ? fmtMoney(it.grossEur) : ''}</TableCell><TableCell align="right">{fmtMoney(it.fee)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </Collapse>

      <ConfirmDialog open={voidOpen} onClose={() => setVoidOpen(false)} busy={busy} title="Void this invoice?" color="error" confirmLabel="Void"
        text="A voided invoice stays on record but no longer counts. A new invoice can then be generated for the same month."
        onConfirm={() => act.mutate({ action: 'void', body: { reason } })}>
        <TextField autoFocus fullWidth label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ mt: 2 }} />
      </ConfirmDialog>
    </Box>
  )
}
