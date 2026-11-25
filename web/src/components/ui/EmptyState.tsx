import type { ReactNode } from 'react'

interface Props {
  /** 위쪽 큰 그림(이모지·SVG). 없으면 생략 */
  icon?: ReactNode
  title?: ReactNode
  children?: ReactNode
  /** 버튼 등 */
  action?: ReactNode
  /** 목록 안 등 좁은 곳: 테두리만 있는 한 줄 */
  compact?: boolean
  /** 카드 안: 테두리 없이 가운데 회색 글만 */
  plain?: boolean
  className?: string
}

/** 비어 있음 / 아직 없음 안내 */
export default function EmptyState({ icon, title, children, action, compact, plain, className = '' }: Props) {
  if (plain) return <p className={`py-6 text-center text-sm text-slate-400 ${className}`}>{children}</p>
  if (compact) {
    return (
      <p className={`rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2.5 text-center text-xs text-slate-400 ${className}`}>
        {title}
        {title && children ? ' ' : null}
        {children}
      </p>
    )
  }
  return (
    <div className={`rounded-xl border border-dashed border-slate-300 bg-white px-6 ${icon || title ? 'py-12' : 'py-8'} text-center ${className}`}>
      {icon && <div className="mb-3 text-3xl">{icon}</div>}
      {title && <p className="text-[15px] font-semibold text-slate-700">{title}</p>}
      {children && <div className={`${title ? 'mt-1' : ''} text-sm text-slate-500`}>{children}</div>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  )
}

/**
 * 서버에 아직 기능이 없을 때 (404). 문구는 모든 화면이 같다:
 *   '서버 준비 중' / '<what> 기능을 서버에서 준비하고 있습니다. 서버가 준비되면 이 화면에서 바로 쓸 수 있습니다.'
 * compact: '<what>: 서버 준비 중입니다.'
 */
export function NotReady({ what, icon, compact, className }: { what: string; icon?: ReactNode; compact?: boolean; className?: string }) {
  if (compact) return <EmptyState compact className={className}>{`${what}: 서버 준비 중입니다.`}</EmptyState>
  return (
    <EmptyState icon={icon} title="서버 준비 중" className={className}>
      {what} 기능을 서버에서 준비하고 있습니다. 서버가 준비되면 이 화면에서 바로 쓸 수 있습니다.
    </EmptyState>
  )
}
