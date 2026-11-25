import type { ScheduleColor } from '../lib/colors'
import { request } from './client'
import type { Category, Schedule, ScheduleInput } from './types'

export const schedulesApi = {
  listSchedules: () => request<Schedule[]>('/schedules/'),
  createSchedule: (data: ScheduleInput) =>
    request<Schedule>('/schedules/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSchedule: (id: number, data: Partial<Schedule>) =>
    request<Schedule>(`/schedules/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteSchedule: (id: number) =>
    request<void>(`/schedules/${id}/`, { method: 'DELETE' }),

  listCategories: () => request<Category[]>('/categories/'),
  createCategory: (name: string, color: ScheduleColor) =>
    request<Category>('/categories/', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),
  updateCategory: (id: number, data: { name?: string; color?: ScheduleColor }) =>
    request<Category>(`/categories/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteCategory: (id: number) =>
    request<void>(`/categories/${id}/`, { method: 'DELETE' }),
}
