import { useCallback, useRef, useState, type ReactNode } from 'react'
import ConfirmDialog from './ConfirmDialog'

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'default'
}

/**
 * 브라우저 confirm() 대신 쓰는 확인 창. `if (!(await ask({...}))) return` 처럼 쓴다.
 * 돌려준 dialog 를 화면 어딘가에 그려 둬야 한다.
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ask = useCallback((o: ConfirmOptions) => {
    resolver.current?.(false)
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  function done(ok: boolean) {
    resolver.current?.(ok)
    resolver.current = null
    setOpts(null)
  }

  const dialog = (
    <ConfirmDialog
      open={opts !== null}
      title={opts?.title ?? ''}
      message={opts?.message ?? ''}
      confirmLabel={opts?.confirmLabel}
      tone={opts?.tone}
      onConfirm={() => done(true)}
      onCancel={() => done(false)}
    />
  )
  return [ask, dialog]
}
