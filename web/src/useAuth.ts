import { createContext, useContext } from 'react'

export interface AuthState {
  username: string | null
  /** 관리자(스태프) 계정 여부 — 어드민 페이지 버튼 노출에 사용 */
  isStaff: boolean
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
