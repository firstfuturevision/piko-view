export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** 상태 칩 색 (배경·글자). 상태 표(meta.ts)가 cls 대신 tone 을 고를 때 쓴다 */
export const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  info: 'bg-blue-100 text-blue-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
}
