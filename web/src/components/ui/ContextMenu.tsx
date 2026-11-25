import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { MenuEntry, MenuItem } from './menuEntries'

const GAP = 8

function isItem(e: MenuEntry): e is MenuItem {
  return typeof e === 'object' && e !== null && 'onSelect' in e
}

/** 빈 것을 빼고, 맨 앞·맨 뒤·겹친 가는 줄을 정리한다 */
function tidy(entries: MenuEntry[]): Exclude<MenuEntry, null | undefined | false>[] {
  const out: Exclude<MenuEntry, null | undefined | false>[] = []
  for (const e of entries) {
    if (!e) continue
    if (e === 'divider' && (out.length === 0 || out[out.length - 1] === 'divider')) continue
    out.push(e)
  }
  while (out[out.length - 1] === 'divider') out.pop()
  return out
}

export interface ContextMenuProps {
  x: number
  y: number
  anchor: Element | null
  entries: MenuEntry[]
  label?: string
  width?: number
  onClose: () => void
}

/** 화면 위에 띄우는 메뉴 상자. 보통은 useContextMenu 로 쓴다 */
export default function ContextMenu({ x, y, anchor, entries, label = '메뉴', width = 200, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<Element | null>(null)
  const list = tidy(entries)

  // 크기를 재고 화면 안으로 (아래 자리가 없으면 ⋯ 버튼 위로)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = y
    if (top + h > vh - GAP) {
      top = anchor ? anchor.getBoundingClientRect().top - h - 4 : vh - h - GAP
    }
    el.style.left = `${Math.max(GAP, Math.min(x, vw - w - GAP))}px`
    el.style.top = `${Math.max(GAP, Math.min(top, vh - h - GAP))}px`
    el.style.visibility = 'visible'
  }, [x, y, anchor])

  // 처음 고를 수 있는 줄로 초점
  useEffect(() => {
    prevFocus.current = document.activeElement
    const first = ref.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')
    first?.focus({ preventScroll: true })
  }, [])

  // 메뉴 밖을 누르거나 스크롤·창 크기 바꾸기·다른 창으로 가면 닫는다
  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && !!ref.current?.contains(t)
    const onDown = (e: PointerEvent) => {
      if (inside(e.target)) return
      if (anchor && e.target instanceof Node && anchor.contains(e.target)) return
      onClose()
    }
    const onScroll = (e: Event) => {
      if (!inside(e.target)) onClose()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
      if (prevFocus.current instanceof HTMLElement) prevFocus.current.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = -1
    if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length
    else if (e.key === 'ArrowUp') next = i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else if (e.key === 'Tab') {
      e.preventDefault()
      onClose()
      return
    }
    if (next >= 0) {
      e.preventDefault()
      items[next].focus()
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: x, top: y, minWidth: width, visibility: 'hidden' }}
      className="fixed z-[55] max-h-[calc(100vh-16px)] max-w-[280px] overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-900/10 print:hidden"
    >
      {list.map((e, i) => {
        if (e === 'divider') return <div key={`d${i}`} role="separator" className="my-1 border-t border-slate-100" />
        if ('swatches' in e) {
          return (
            <div key={`s${i}`} role="group" className="grid grid-cols-5 gap-1.5 px-3 py-1.5">
              {e.swatches.map((sw) => (
                <button
                  key={sw.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={!!sw.checked}
                  aria-label={sw.label}
                  data-tip={sw.label}
                  tabIndex={-1}
                  onClick={() => {
                    onClose()
                    e.onPick(sw.key)
                  }}
                  className={`grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold text-white outline-none transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
                    sw.checked ? 'ring-2 ring-slate-700 ring-offset-2' : ''
                  }`}
                  style={{ background: sw.color }}
                >
                  {sw.checked ? '✓' : ''}
                </button>
              ))}
            </div>
          )
        }
        if (!isItem(e)) {
          return (
            <div key={`h${i}`} className="px-3 pt-1.5 pb-0.5 text-[11px] font-semibold text-slate-400" aria-hidden>
              {e.heading}
            </div>
          )
        }
        return (
          <button
            key={`i${i}`}
            type="button"
            role={e.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={e.checked}
            disabled={e.disabled}
            data-tip={e.tip}
            tabIndex={-1}
            onClick={() => {
              onClose()
              e.onSelect()
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition outline-none hover:bg-slate-100 focus-visible:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
              e.danger ? 'text-red-600' : 'text-slate-700'
            }`}
          >
            <span className="w-4 shrink-0 text-center text-[13px]" aria-hidden>
              {e.checked ? '✓' : e.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{e.label}</span>
            {e.hint && <span className="shrink-0 text-[11px] text-slate-400">{e.hint}</span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
