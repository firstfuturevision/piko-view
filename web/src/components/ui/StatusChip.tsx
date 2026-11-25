import type { ReactNode } from 'react'
import { TONE_CLASS, type StatusTone } from './statusTone'

/** 상태를 보이는 작은 칩 */
export default function StatusChip({
  tone = 'neutral',
  children,
  tip,
  className = '',
}: {
  tone?: StatusTone
  children: ReactNode
  tip?: string
  className?: string
}) {
  return (
    <span data-tip={tip} className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]} ${className}`}>
      {children}
    </span>
  )
}
