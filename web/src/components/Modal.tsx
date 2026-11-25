import { useRef, type ReactNode } from 'react'
import { useDialog } from './useDialog'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Tailwind max-width 클래스 (기본 max-w-lg) */
  widthClass?: string
}

export default function Modal({ open, ...rest }: Props) {
  if (!open) return null
  return <ModalBody {...rest} />
}

function ModalBody({ title, onClose, children, widthClass = 'max-w-lg' }: Omit<Props, 'open'>) {
  const box = useRef<HTMLDivElement>(null)
  useDialog(box, onClose)

  return (
    // 바깥(배경) 클릭으로는 닫히지 않는다 — 닫기는 ✕ 버튼 / ESC / 취소 버튼으로만.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`max-h-[90dvh] w-full ${widthClass} overflow-y-auto overscroll-contain rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/5 focus:outline-none`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[17px] font-bold tracking-tight text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
