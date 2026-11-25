import { createContext, useContext } from 'react'

export type ToastTone = 'default' | 'error'
export type ToastFn = (msg: string, opts?: { tone?: ToastTone; ms?: number }) => void

export const ToastContext = createContext<ToastFn | null>(null)

/** 화면 아래에 잠깐 뜨는 알림을 띄운다. <ToastProvider> 안에서만 쓴다 */
export function useToast(): ToastFn {
  const fn = useContext(ToastContext)
  if (!fn) throw new Error('useToast 는 <ToastProvider> 안에서 써야 합니다.')
  return fn
}
