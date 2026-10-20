import { Alert, Snackbar } from '@mui/material'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const show = useCallback((message, severity = 'success') => setToast({ message, severity, key: Date.now() }), [])
  const value = useMemo(() => show, [show])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar key={toast?.key} open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
