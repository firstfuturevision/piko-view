import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { AuthContext } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)
  const [isStaff, setIsStaff] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .me()
      .then((res) => {
        setUsername(res.username)
        setIsStaff(res.is_staff)
      })
      .catch(() => {
        setUsername(null)
        setIsStaff(false)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (name: string, password: string) => {
    const res = await api.login(name, password)
    setUsername(res.username)
    setIsStaff(res.is_staff)
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setUsername(null)
    setIsStaff(false)
  }, [])

  return (
    <AuthContext.Provider value={{ username, isStaff, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
