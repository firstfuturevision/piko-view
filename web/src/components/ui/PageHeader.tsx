import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  /** 제목 옆 도움말 버튼 (<HelpButton page=… />) */
  help?: ReactNode
  /** 제목 옆 작은 표시 (예: '실험실' 칩) */
  badge?: ReactNode
  /** 제목 아래 한두 줄 설명 */
  description?: ReactNode
  /** 제목 줄에 붙는 탭 (<Tabs …/>) */
  tabs?: ReactNode
  /** 오른쪽 버튼들 */
  actions?: ReactNode
  className?: string
}

/** 화면 맨 위 제목 줄: h1 제목 · 도움말 · 탭 · 오른쪽 버튼 */
export default function PageHeader({ title, help, badge, description, tabs, actions, className = 'mb-6' }: Props) {
  return (
    <header className={className}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[22px] font-bold tracking-tight text-slate-900">{title}</h1>
          {badge}
          {help}
        </div>
        {tabs}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-2 max-w-3xl text-sm text-slate-500">{description}</p>}
    </header>
  )
}
