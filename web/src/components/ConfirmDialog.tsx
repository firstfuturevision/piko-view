import { useState, type ReactNode } from 'react'
import Modal from './Modal'
import { buttonClass } from './ui/buttonClass'

interface Props {
  open: boolean
  title: string
  message: ReactNode
  /**
   * 확인 버튼 글. 비우면 tone 에서 정한다: 'danger' → '삭제', 'default' → '확인'.
   * 삭제가 아닌 위험한 일(폐기·내보내기·견적 보내기 등)은 그 동작 이름을 적는다
   */
  confirmLabel?: string
  /** 'danger'(기본): 빨간 버튼 / 'default': 파란 버튼 */
  tone?: 'danger' | 'default'
  /** 처리 중: 버튼을 막고 '처리 중…' 을 보인다. onConfirm 이 Promise 를 돌려주면 알아서 켠다 */
  busy?: boolean
  onConfirm: () => unknown
  onCancel: () => void
}

export default function ConfirmDialog({ open, title, message, confirmLabel, tone = 'danger', busy, onConfirm, onCancel }: Props) {
  const [running, setRunning] = useState(false)
  const working = busy || running
  const label = confirmLabel ?? (tone === 'danger' ? '삭제' : '확인')

  function confirm() {
    const r = onConfirm()
    if (r instanceof Promise) {
      setRunning(true)
      void r.finally(() => setRunning(false))
    }
  }

  return (
    <Modal open={open} title={title} onClose={working ? () => {} : onCancel} widthClass="max-w-sm">
      <div className="text-sm whitespace-pre-line text-slate-600">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={working} className={`${buttonClass('secondary')} px-4 py-2`}>
          취소
        </button>
        <button
          type="button"
          data-autofocus={tone === 'default' ? true : undefined}
          onClick={confirm}
          disabled={working}
          aria-busy={working || undefined}
          className={`${buttonClass(tone === 'danger' ? 'danger' : 'primary')} px-4 py-2`}
        >
          {working ? '처리 중…' : label}
        </button>
      </div>
    </Modal>
  )
}
