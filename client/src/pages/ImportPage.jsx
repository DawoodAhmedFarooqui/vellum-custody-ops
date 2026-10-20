import UploadFileIcon from '@mui/icons-material/UploadFile'
import { Alert, Box, Button, Chip, CircularProgress, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import { api, qs } from '../api.js'
import { useAuth } from '../auth.jsx'
import { ErrorAlert, StatusChip } from '../components/common.jsx'
import { fmtDateTime } from '../format.js'

export default function ImportPage() {
  const { id } = useParams()
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [file, setFile] = useState(null)
  const history = useQuery({ queryKey: ['imports'], queryFn: () => api.get('/api/imports') })
  const detail = useQuery({ queryKey: ['import', id], queryFn: () => api.get(`/api/imports/${id}`), enabled: Boolean(id) })

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData()
      form.append('file', file)
      return api.upload('/api/imports', form)
    },
    onSuccess: (result) => {
      setFile(null)
      queryClient.invalidateQueries({ queryKey: ['imports'] })
      queryClient.invalidateQueries({ queryKey: ['/api/transactions'] })
      navigate(`/imports/${result.id}`)
    },
  })

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 4 }}>
        <Typography variant="h5" sx={{ mb: 1.5 }}>Custodian import</Typography>
        {can('import:run') ? (
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Upload the custodian's monthly export (semicolon-separated, German dates and numbers). Valid rows become pending transactions;
              rows with problems are listed with the reason. Uploading the same file again is safe: already imported rows are recognised.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
                Choose file
                <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { setFile(e.target.files[0] || null); upload.reset() }} />
              </Button>
              <Typography variant="body2" noWrap sx={{ flex: 1 }}>{file?.name || 'No file chosen'}</Typography>
              <Button variant="contained" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>Import</Button>
            </Stack>
            <ErrorAlert error={upload.error} sx={{ mt: 2 }} onClose={() => upload.reset()} />
          </Paper>
        ) : <Alert severity="info" sx={{ mb: 2 }}>Your role can view past imports but not upload files.</Alert>}

        <Paper>
          <Typography variant="subtitle2" sx={{ p: 1.5, pb: 0 }}>Previous imports</Typography>
          <Table size="small">
            <TableHead><TableRow><TableCell>When</TableCell><TableCell>File</TableCell><TableCell align="right">OK</TableCell><TableCell align="right">Dup</TableCell><TableCell align="right">Err</TableCell></TableRow></TableHead>
            <TableBody>
              {history.data?.length === 0 && <TableRow><TableCell colSpan={5}><Typography color="text.secondary">None yet.</Typography></TableCell></TableRow>}
              {history.data?.map((i) => (
                <TableRow key={i.id} hover selected={String(i.id) === id} sx={{ cursor: 'pointer' }} onClick={() => navigate(`/imports/${i.id}`)}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDateTime(i.uploadedAt)}</TableCell>
                  <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.filename}</TableCell>
                  <TableCell align="right">{i.imported}</TableCell><TableCell align="right">{i.duplicates}</TableCell><TableCell align="right">{i.errors}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 8 }}>
        {id && (detail.isLoading ? <CircularProgress /> : detail.error ? <ErrorAlert error={detail.error} /> : <ImportResult result={detail.data} />)}
      </Grid>
    </Grid>
  )
}

function ImportResult({ result }) {
  const [show, setShow] = useState('PROBLEMS')
  const { counts, results } = result
  const visible = results.filter((r) => show === 'ALL' || (show === 'PROBLEMS' ? r.outcome !== 'IMPORTED' : r.outcome === show))
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="h6">{result.filename}</Typography>
        <Typography variant="body2" color="text.secondary">{fmtDateTime(result.uploadedAt)} by {result.uploadedBy}</Typography>
        <span style={{ flex: 1 }} />
        <Chip color="success" label={`${counts.imported} imported`} size="small" />
        <Chip color="info" label={`${counts.duplicates} already imported`} size="small" />
        <Chip color="error" label={`${counts.errors} errors`} size="small" />
      </Stack>
      {result.previousUpload && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          This exact file was already uploaded {fmtDateTime(result.previousUpload.uploadedAt)} by {result.previousUpload.uploadedBy}
          {' '}(<RouterLink to={`/imports/${result.previousUpload.id}`}>see that import</RouterLink>). Nothing was imported twice.
        </Alert>
      )}
      <Stack direction="row" spacing={2} sx={{ mb: 1, alignItems: 'center' }}>
        <ToggleButtonGroup size="small" exclusive value={show} onChange={(e, v) => v && setShow(v)}>
          <ToggleButton value="PROBLEMS">Problems</ToggleButton>
          <ToggleButton value="ERROR">Errors</ToggleButton>
          <ToggleButton value="DUPLICATE">Duplicates</ToggleButton>
          <ToggleButton value="IMPORTED">Imported</ToggleButton>
          <ToggleButton value="ALL">All rows</ToggleButton>
        </ToggleButtonGroup>
        {counts.imported > 0 && <Button size="small" component={RouterLink} to={`/transactions${qs({ importId: result.id, status: 'PENDING' })}`}>Open imported transactions</Button>}
      </Stack>
      <Paper>
        <Table size="small">
          <TableHead><TableRow><TableCell>Line</TableCell><TableCell>Referenz</TableCell><TableCell>Outcome</TableCell><TableCell>Details</TableCell></TableRow></TableHead>
          <TableBody>
            {visible.length === 0 && <TableRow><TableCell colSpan={4}><Typography color="text.secondary" sx={{ p: 1 }}>Nothing to show.</Typography></TableCell></TableRow>}
            {visible.map((r) => (
              <TableRow key={r.line} hover>
                <TableCell>{r.line}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{r.externalRef || <em>(empty)</em>}</TableCell>
                <TableCell><StatusChip value={r.outcome} /></TableCell>
                <TableCell>
                  {r.errors ? <ul style={{ margin: 0, paddingLeft: 18 }}>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                    : r.transactionId ? <>{r.message || 'Imported as'} {r.outcome === 'IMPORTED' && <RouterLink to={`/transactions?q=${r.transactionId}`}>{r.transactionId}</RouterLink>}</>
                      : r.message}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}
