import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ConfirmDialog from './ConfirmDialog'
import { useDialog } from './useDialog'

interface Props {
  /** 화면 읽기 프로그램용 이름 */
  label: string
  /** 기본 머리글 제목. header 를 주면 쓰지 않는다 */
  title?: ReactNode
  /** 머리글을 직접 그릴 때 */
  header?: ReactNode
  onClose: () => void
  /** 저장하지 않은 입력이 있음: 바깥 클릭·ESC 로 닫으려 하면 먼저 묻는다 */
  dirty?: boolean
  footer?: ReactNode
  children: ReactNode
  widthClass?: string
  bodyClass?: string
}

/** 오른쪽 서랍. 붙어 있는 동안 열린 것으로 본다 (조건부로 그린다) */
export default function Drawer({
  label,
  title,
  header,
  onClose,
  dirty = false,
  footer,
  children,
  widthClass = 'max-w-lg',
  bodyClass = 'space-y-5 px-5 py-4 text-sm',
}: Props) {
  const panel = useRef<HTMLElement>(null)
  const [asking, setAsking] = useState(false)
  const tryClose = () => (dirty ? setAsking(true) : onClose())
  useDialog(panel, tryClose)

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden className="absolute inset-0 bg-slate-900/30" onClick={tryClose} />
      <aside
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`relative flex h-full w-full ${widthClass} flex-col bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl focus:outline-none`}
      >
        {header ?? (
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h3 className="text-[17px] font-bold text-slate-900">{title}</h3>
            <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">
              ✕
            </button>
          </div>
        )}
        <div className={`flex-1 overflow-y-auto overscroll-contain ${bodyClass}`}>{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </aside>
      <ConfirmDialog
        open={asking}
        title="저장하지 않은 입력"
        message="저장하지 않은 입력이 있습니다. 저장하지 않고 닫을까요?"
        confirmLabel="닫기"
        tone="danger"
        onConfirm={() => {
          setAsking(false)
          onClose()
        }}
        onCancel={() => setAsking(false)}
      />
    </div>,
    document.body,
  )
}
