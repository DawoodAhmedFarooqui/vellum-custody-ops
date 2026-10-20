import { Box, CircularProgress } from '@mui/material'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import { ToastProvider } from './components/Toast.jsx'
import ClientDetailPage, { ClientAudit, ClientInvoices, ClientOverview, ClientPortfolios, ClientTransactions } from './pages/ClientDetailPage.jsx'
import ClientsPage from './pages/ClientsPage.jsx'
import ImportPage from './pages/ImportPage.jsx'
import InvoiceDetailPage from './pages/InvoiceDetailPage.jsx'
import InvoicesPage from './pages/InvoicesPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import TransactionsPage from './pages/TransactionsPage.jsx'

function RequireAuth({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  if (user === undefined) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress /></Box>
  }
  // Remember where the user was going, so a pasted link still opens the right view after signing in.
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Navigate to="/clients" replace />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:id" element={<ClientDetailPage />}>
            <Route index element={<ClientOverview />} />
            <Route path="portfolios" element={<ClientPortfolios />} />
            <Route path="transactions" element={<ClientTransactions />} />
            <Route path="invoices" element={<ClientInvoices />} />
            <Route path="audit" element={<ClientAudit />} />
          </Route>
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="imports" element={<ImportPage />} />
          <Route path="imports/:id" element={<ImportPage />} />
          <Route path="*" element={<Navigate to="/clients" replace />} />
        </Route>
      </Routes>
    </ToastProvider>
  )
}
