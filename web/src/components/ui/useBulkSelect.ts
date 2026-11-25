import { useRef, useState, type MouseEvent } from 'react'

/**
 * 카드 목록에서 여러 개 고르기 (문서·슬라이드·디자인·그래프 목록이 같이 쓴다).
 * - 카드 오른쪽 위 고르는 칸: 마우스를 올리거나 고르기 중일 때 보인다
 * - Shift 를 누르고 고르면 마지막으로 고른 것부터 그 칸까지 한꺼번에
 * - 폰: 카드를 길게 누르거나 '선택' 단추로 고르기에 들어간다. 고르기 중에는 카드를 눌러도 열지 않고 고른다
 * - PC: 빈 자리를 끌어 네모 안의 카드를 한꺼번에 고르고(useMarqueeSelect), Ctrl·Cmd 를 누른 채 카드를 누르면 하나씩 더하고 뺀다
 * visible 은 지금 화면에 보이는 순서(검색·탭으로 거른 결과), selectable 은 지울 수 있는 것만 true.
 */
export function useBulkSelect<T extends { id: number }>(visible: T[], selectable: (item: T) => boolean = () => true) {
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [manual, setManual] = useState(false)
  const anchor = useRef<number | null>(null)
  const pressTimer = useRef<number | null>(null)
  const pressed = useRef(false)
  const touching = useRef(false)

  // 거르기가 바뀌어 안 보이게 된 것은 고른 것에서 뺀다
  const visibleIds = new Set(visible.map((v) => v.id))
  const selected = visible.filter((v) => picked.has(v.id))
  const selecting = manual || selected.length > 0
  const choosable = visible.filter(selectable)
  const allPicked = choosable.length > 0 && choosable.every((v) => picked.has(v.id))

  function toggle(item: T, shift = false) {
    if (!selectable(item)) return
    // 기준점은 지금 읽어 둔다 (setPicked 안은 나중에 돌아 그때는 이미 이 칸으로 바뀌어 있다)
    const from = anchor.current === null ? -1 : visible.findIndex((v) => v.id === anchor.current)
    const to = visible.findIndex((v) => v.id === item.id)
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)))
      if (shift && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from]
        for (const v of visible.slice(a, b + 1)) if (selectable(v)) next.add(v.id)
      } else if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
    anchor.current = item.id
  }

  /** 끌어서 고르기: 네모에 걸친 카드로 바꾼다. base 를 주면 그 위에 더한다 (Shift·Ctrl 끌기) */
  function selectIds(ids: number[], base: number[] = []) {
    const ok = new Set(visible.filter(selectable).map((v) => v.id))
    setPicked(new Set([...base, ...ids].filter((id) => ok.has(id))))
  }

  function clear() {
    setPicked(new Set())
    setManual(false)
    anchor.current = null
  }

  function selectAll() {
    setPicked(allPicked ? new Set() : new Set(choosable.map((v) => v.id)))
  }

  /** 카드에 붙인다: 고르기 중이면 눌러도 열지 않고 고르고, 길게 누르면 고르기에 들어간다 */
  function cardProps(item: T) {
    const stop = () => {
      if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    return {
      // 끌어서 고르기가 카드를 찾는 표시
      'data-bulk-id': item.id,
      onClickCapture: (e: MouseEvent) => {
        if (pressed.current) {
          pressed.current = false
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if ((e.target as HTMLElement).closest('[data-bulk-skip]')) return
        // Ctrl·Cmd 누른 채 누르면 고르기 상태가 아니어도 하나씩 더하고 뺀다 (새 탭으로 열지 않음)
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          e.stopPropagation()
          toggle(item)
          return
        }
        if (!selecting) return
        e.preventDefault()
        e.stopPropagation()
        toggle(item, e.shiftKey)
      },
      // 폰에서 길게 누르면 브라우저가 우클릭 메뉴도 띄우려 하므로, 길게 눌러 고른 때는 메뉴를 막는다
      onContextMenuCapture: (e: MouseEvent) => {
        if (!pressed.current && !touching.current) return
        e.preventDefault()
        e.stopPropagation()
      },
      onTouchStart: () => {
        stop()
        pressed.current = false
        touching.current = true
        pressTimer.current = window.setTimeout(() => {
          pressed.current = true
          setManual(true)
          if (!picked.has(item.id)) toggle(item)
        }, 500)
      },
      onTouchMove: () => {
        stop()
        touching.current = false
      },
      onTouchEnd: () => {
        stop()
        window.setTimeout(() => (touching.current = false), 50)
      },
    }
  }

  return {
    selected,
    selecting,
    allPicked,
    choosableCount: choosable.length,
    isSelected: (item: T) => picked.has(item.id),
    pickedIds: () => [...picked].filter((id) => visibleIds.has(id)),
    selectIds,
    canSelect: selectable,
    toggle,
    clear,
    selectAll,
    start: () => setManual(true),
    cardProps,
  }
}

export type BulkSelect<T extends { id: number }> = ReturnType<typeof useBulkSelect<T>>

/** 지운 결과를 한 줄 글로: 실패가 있으면 무엇이 안 지워졌는지 */
export function bulkResultText(what: string, r: { removed: number; failed: { name: string; reason: string }[] }) {
  if (r.failed.length === 0) return `${what} ${r.removed}개를 지웠습니다.`
  const names = r.failed.map((f) => `'${f.name}'(${f.reason})`).join(', ')
  return `${r.removed}개를 지웠고, ${r.failed.length}개는 지우지 못했습니다: ${names}`
}
