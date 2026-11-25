import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/**
 * 단추 아래에 뜨는 메뉴를 화면 맨 위 층(body)에 띄운다. 머리줄·도구 막대가 옆으로 굴러가는 상자(overflow) 안에 있어도
 * 메뉴가 잘리지 않게 한다. 화면을 굴리거나 창 크기가 바뀌면 단추를 따라가고, 화면 아래로 넘치면 위로 띄운다.
 */
export default function FloatMenu({
  anchor,
  align = 'left',
  className = '',
  children,
  menuRef,
  role = 'menu',
}: {
  anchor: RefObject<HTMLElement | null>
  align?: 'left' | 'right'
  className?: string
  children: ReactNode
  menuRef?: RefObject<HTMLDivElement | null>
  role?: string
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; maxH: number } | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - 8
      const above = r.top - 8
      const up = below < 220 && above > below
      setPos({
        top: up ? Math.max(8, r.top - 4 - Math.min(above, 480)) : r.bottom + 4,
        ...(align === 'right' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.min(r.left, window.innerWidth - 120) }),
        maxH: Math.min(480, up ? above : below),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, align])
  if (!pos) return null
  return createPortal(
    <div
      ref={menuRef}
      role={role}
      className={`fixed z-[60] overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-900/10 ${className}`}
      style={{ top: pos.top, left: pos.left, right: pos.right, maxHeight: pos.maxH }}
    >
      {children}
    </div>,
    document.body,
  )
}
