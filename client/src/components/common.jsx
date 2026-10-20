import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { STATUS_COLOR, titleCase } from '../format.js'

export const StatusChip = ({ value, size = 'small' }) => (
  value ? <Chip label={titleCase(value)} color={STATUS_COLOR[value] || 'default'} size={size} variant={STATUS_COLOR[value] === 'default' ? 'outlined' : 'filled'} /> : null
)

// Shows an API error with its field-level details, if any.
export function ErrorAlert({ error, onClose, sx }) {
  if (!error) return null
  const fields = error.details?.fields
  return (
    <Alert severity="error" onClose={onClose} sx={sx}>
      {error.message}
      {fields && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {Object.entries(fields).map(([f, msg]) => <li key={f}><b>{f}</b>: {msg}</li>)}
        </ul>
      )}
    </Alert>
  )
}

export function ConfirmDialog({ open, title, text, confirmLabel = 'Confirm', color = 'primary', onConfirm, onClose, busy, children }) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {text && <DialogContentText>{text}</DialogContentText>}
        {children}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={onConfirm} variant="contained" color={color} disabled={busy}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  )
}
