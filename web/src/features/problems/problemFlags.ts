import type { Problem } from '../../api'

/** 이 날 수 넘게 아무도 고치지 않은 미해결·해결 중 문제는 '막힘'으로 본다 */
export const STALE_DAYS = 2

const DAY = 24 * 60 * 60 * 1000

/** 오늘 날짜 (사용자 시간대 기준 YYYY-MM-DD) */
export function todayString(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

function isActive(p: Problem) {
  return p.status === 'open' || p.status === 'solving' || p.status === 'on_hold'
}

/** 결정 기한까지 남은 날 (지났으면 음수). 기한이 없거나 끝난 문제면 null */
export function daysLeft(p: Problem, today = todayString()): number | null {
  if (!p.due_date || !isActive(p)) return null
  return Math.round((Date.parse(p.due_date) - Date.parse(today)) / DAY)
}

/** 마지막으로 고친 뒤 지난 날 수. 막힘으로 볼 문제가 아니면 null */
export function idleDays(p: Problem, now = Date.now()): number | null {
  if (p.status !== 'open' && p.status !== 'solving') return null
  const days = Math.floor((now - Date.parse(p.updated_at)) / DAY)
  return days >= STALE_DAYS ? days : null
}
