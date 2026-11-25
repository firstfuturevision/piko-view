import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTipsEnabled } from '../lib/tips'

const SHOW_DELAY_MS = 450
const GAP = 8

interface Tip {
  text: string
  x: number
  y: number
  below: boolean
}

/**
 * 화면 어디서나 data-tip="설명" 이 붙은 요소에 마우스를 올리면 말풍선을 띄운다.
 * (마우스만. 터치 화면에서는 띄우지 않는다. 사이드바에서 끌 수 있다)
 */
export default function TooltipLayer() {
  const enabled = useTipsEnabled()
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!enabled) return
    function hide() {
      window.clearTimeout(timer.current)
      current.current = null
      setTip(null)
    }
    function over(e: PointerEvent) {
      if (e.pointerType !== 'mouse') return
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]')
      if (el === current.current) return
      hide()
      if (!el?.dataset.tip) return
      current.current = el
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return
        const r = el.getBoundingClientRect()
        const below = r.top < 80
        setTip({ text: el.dataset.tip ?? '', x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, below })
      }, SHOW_DELAY_MS)
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [enabled])

  if (!enabled || !tip) return null
  const half = 140
  const left = Math.min(Math.max(tip.x, half + 8), window.innerWidth - half - 8)
  return createPortal(
    <div
      role="tooltip"
      style={{ left, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}
      className="pointer-events-none fixed z-[100] max-w-[280px] rounded-lg bg-slate-900/95 px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-line text-white shadow-lg"
    >
      {tip.text}
    </div>,
    document.body,
  )
}
