import LogoutIcon from '@mui/icons-material/Logout'
import { AppBar, Box, Button, Chip, Container, IconButton, Toolbar, Tooltip, Typography } from '@mui/material'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { titleCase } from '../format.js'

const NAV = [
  { to: '/clients', label: 'Clients' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/imports', label: 'Import' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  return (
    <Box sx={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static">
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Typography variant="h6" sx={{ mr: 3, fontWeight: 600 }}>Custody Ops</Typography>
          {NAV.map((n) => (
            <Button key={n.to} component={NavLink} to={n.to} color="inherit"
              sx={{ '&.active': { bgcolor: 'rgba(255,255,255,0.18)' } }}>
              {n.label}
            </Button>
          ))}
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2">{user.name}</Typography>
          <Chip label={titleCase(user.role)} size="small" color="secondary" variant="outlined" sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.6)' }} />
          <Tooltip title="Sign out"><IconButton color="inherit" onClick={logout} size="small"><LogoutIcon /></IconButton></Tooltip>
        </Toolbar>
      </AppBar>
      <Container maxWidth={false} sx={{ py: 2, flex: 1 }}>
        <Outlet />
      </Container>
    </Box>
  )
}
