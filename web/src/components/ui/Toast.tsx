import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastFn, type ToastTone } from './toastContext'

/** 앱 전체에 하나. 새 알림이 오면 앞 알림을 바꾼다 (기본 2.6초, 긴 글은 더 오래) */
export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; tone: ToastTone; id: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback<ToastFn>((msg, opts) => {
    window.clearTimeout(timer.current)
    if (!msg) {
      setToast(null)
      return
    }
    setToast({ msg, tone: opts?.tone ?? 'default', id: Date.now() })
    const ms = opts?.ms ?? (msg.length > 30 ? 5000 : 2600)
    timer.current = window.setTimeout(() => setToast(null), ms)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4 print:hidden">
        {toast && (
          <div
            key={toast.id}
            className={`pointer-events-auto max-w-[90vw] rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
              toast.tone === 'error' ? 'bg-rose-600' : 'bg-slate-800'
            }`}
          >
            {toast.msg}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
