import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from './api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = still checking the session

  useEffect(() => {
    api.get('/api/auth/me').then(setUser).catch(() => setUser(null))
  }, [])

  const login = useCallback(async (email, password) => setUser(await api.post('/api/auth/login', { email, password })), [])
  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setUser(null)
  }, [])

  const value = useMemo(() => ({
    user,
    login,
    logout,
    // Mirrors the server's permission list; the server is still the one that enforces it.
    can: (permission) => Boolean(user?.permissions?.includes(permission)),
  }), [user, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
