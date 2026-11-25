import type { ProblemStatus } from '../api'

export const PROBLEM_STATUS_META: Record<
  ProblemStatus,
  { label: string; headerCls: string; dotCls: string }
> = {
  open: { label: '미해결', headerCls: 'text-slate-600', dotCls: 'bg-slate-400' },
  solving: { label: '해결 중', headerCls: 'text-blue-600', dotCls: 'bg-blue-500' },
  on_hold: { label: '보류', headerCls: 'text-amber-600', dotCls: 'bg-amber-500' },
  solved: { label: '해결 완료', headerCls: 'text-green-600', dotCls: 'bg-emerald-500' },
  paused: { label: '중단', headerCls: 'text-red-500', dotCls: 'bg-rose-400' },
}

export const PROBLEM_STATUS_ORDER: ProblemStatus[] = [
  'open',
  'solving',
  'on_hold',
  'solved',
  'paused',
]
