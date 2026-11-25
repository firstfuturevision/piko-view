import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

interface Bulk {
  selectIds: (ids: number[], base?: number[]) => void
  pickedIds: () => number[]
  clear: () => void
  selecting: boolean
}

/** 눌러도 끌기를 시작하지 않는 곳: 카드·단추·입력 칸·글자 제목 (글자 끌어 고르기와 부딪히지 않게) */
const SKIP = '[data-bulk-id], a, button, input, textarea, select, label, h1, h2, h3, p, [contenteditable], [role=dialog]'
const EDGE = 48

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n
  }
  return null
}

/**
 * 끌어서 여러 개 고르기 (PC 마우스만 — 폰·태블릿은 스크롤과 겹쳐 '선택' 단추·길게 누르기를 쓴다).
 * 목록을 감싼 칸에 onPointerDown 을 붙이고 overlay 를 그 안 아무 데나 그린다.
 * 빈 자리에서 5px 넘게 끌면 네모를 그려 걸친 카드([data-bulk-id])를 고르고, Shift·Ctrl·Cmd 를 누르면 고른 것에 더한다.
 * 화면 끝에 닿으면 따라 스크롤한다. 짧게 누르면(끌지 않으면) 고른 것을 풀고, Esc 로도 푼다.
 */
export function useMarqueeSelect(bulk: Bulk) {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const bulkRef = useRef(bulk)
  useEffect(() => {
    bulkRef.current = bulk
  })

  // Esc 로 고른 것 풀기 (입력 칸·창 안에서 누른 Esc 는 그쪽 몫)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !bulkRef.current.selecting) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable], [role=dialog]')) return
      // 떠 있는 창(확인 창 등)이 있으면 Esc 는 그 창을 닫는 몫 (아래 알림 권유 같은 띠는 셈하지 않음)
      if (document.querySelector('[aria-modal="true"]')) return
      bulkRef.current.clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest(SKIP)) return
    const box = e.currentTarget
    const scroller = scrollParent(box)
    const add = e.shiftKey || e.ctrlKey || e.metaKey
    const base = add ? bulkRef.current.pickedIds() : []
    // 시작점은 문서 기준(스크롤 포함)으로 기억해 두고 스크롤해도 네모가 따라 늘어나게
    const scrollTop = () => (scroller ? scroller.scrollTop : window.scrollY)
    const startX = e.clientX
    const startY = e.clientY + scrollTop()
    let lastX = e.clientX
    let lastY = e.clientY
    let dragging = false
    let raf = 0

    const update = () => {
      const curY = lastY + scrollTop()
      const top = Math.min(startY, curY) - scrollTop()
      const left = Math.min(startX, lastX)
      const r = { x: left, y: top, w: Math.abs(lastX - startX), h: Math.abs(curY - startY) }
      setRect(r)
      const ids: number[] = []
      box.querySelectorAll<HTMLElement>('[data-bulk-id]').forEach((el) => {
        const b = el.getBoundingClientRect()
        if (b.right >= r.x && b.left <= r.x + r.w && b.bottom >= r.y && b.top <= r.y + r.h) ids.push(Number(el.dataset.bulkId))
      })
      bulkRef.current.selectIds(ids, base)
    }

    // 화면 위·아래 끝에 닿으면 계속 스크롤
    const tick = () => {
      const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
      const step = lastY < view.top + EDGE ? -14 : lastY > view.bottom - EDGE ? 14 : 0
      if (step) {
        if (scroller) scroller.scrollTop += step
        else window.scrollBy(0, step)
        update()
      }
      raf = requestAnimationFrame(tick)
    }

    const move = (ev: PointerEvent) => {
      lastX = ev.clientX
      lastY = ev.clientY
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY + scrollTop() - startY) < 5) return
      if (!dragging) {
        dragging = true
        document.body.style.userSelect = 'none'
        raf = requestAnimationFrame(tick)
      }
      update()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      cancelAnimationFrame(raf)
      document.body.style.userSelect = ''
      setRect(null)
      // 빈 자리를 짧게 누르면 고른 것을 푼다 (더하기 키를 누르고 있었으면 그대로)
      if (!dragging && !add && bulkRef.current.selecting) bulkRef.current.clear()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const overlay: ReactNode = rect ? (
    <div
      aria-hidden
      className="pointer-events-none fixed z-30 rounded-sm border border-blue-400 bg-blue-400/10"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  ) : null

  return { onPointerDown, overlay }
}
