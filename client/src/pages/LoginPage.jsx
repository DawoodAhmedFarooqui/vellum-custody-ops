import { Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { ErrorAlert } from '../components/common.jsx'

export default function LoginPage() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={location.state?.from || '/clients'} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Paper component="form" onSubmit={submit} sx={{ p: 4, width: 380 }}>
        <Stack spacing={2}>
          <Typography variant="h5" fontWeight={600}>Custody Ops Console</Typography>
          <Typography variant="body2" color="text.secondary">Vellum Fund Services · back office</Typography>
          <ErrorAlert error={error} />
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required autoComplete="username" />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          <Button type="submit" variant="contained" disabled={busy} size="large">Sign in</Button>
        </Stack>
      </Paper>
    </Box>
  )
}
