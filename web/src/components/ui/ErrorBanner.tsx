import type { ReactNode } from 'react'

/** 오류 띠. 내용이 비면 아무것도 그리지 않는다. 화면 읽기 프로그램이 바로 읽도록 role="alert" */
export default function ErrorBanner({
  children,
  onClose,
  className = '',
}: {
  children: ReactNode
  onClose?: () => void
  className?: string
}) {
  if (children === null || children === undefined || children === '' || children === false) return null
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 ${className}`}>
      <div className="min-w-0 flex-1 whitespace-pre-line">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="오류 닫기" className="shrink-0 rounded px-1 text-red-400 hover:bg-red-100 hover:text-red-600">
          ✕
        </button>
      )}
    </div>
  )
}
