import { request } from './client'
import type { Profile, UserSummary } from './types'

export const authApi = {
  me: () =>
    request<{ username: string | null; is_staff: boolean }>('/auth/me/'),
  login: (username: string, password: string) =>
    request<{ username: string; is_staff: boolean }>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ ok: boolean }>('/auth/logout/', { method: 'POST' }),
  getProfile: () => request<Profile>('/auth/profile/'),
  listUsers: () => request<UserSummary[]>('/auth/users/'),
  /** 관리자: 다른 사람의 역할 고치기 */
  setUserRole: (id: number, role: string) =>
    request<UserSummary>('/auth/users/', { method: 'PATCH', body: JSON.stringify({ id, role }) }),
  updateProfile: (data: { nickname?: string; role?: string }) =>
    request<Profile>('/auth/profile/', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}
