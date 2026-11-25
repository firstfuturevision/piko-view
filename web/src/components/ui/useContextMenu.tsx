import { useCallback, useState, type MouseEvent, type ReactNode } from 'react'
import { copyText } from '../../lib/clipboard'
import ContextMenu from './ContextMenu'
import { absoluteUrl, shouldUseNativeMenu, type MenuEntry } from './menuEntries'
import { useToast } from './toastContext'

interface OpenState<T> {
  target: T
  x: number
  y: number
  /** ⋯ 버튼에서 연 경우: 그 버튼 (다시 누르면 닫고, 아래 자리가 없으면 위로 띄운다) */
  anchor: Element | null
}

interface Options {
  /** 화면 읽기 프로그램용 메뉴 이름 */
  label?: string
  /** 메뉴 최소 너비(px) */
  width?: number
}

/**
 * 우클릭·⋯ 버튼 메뉴. 고를 것들은 build(대상) 로 그때그때 만든다.
 *
 *   const menu = useContextMenu((t: Item) => [{ label: '열기', onSelect: () => open(t) }, 'divider', ...])
 *   <li onContextMenu={menu.onContextMenu(item)}>  … <button onClick={(e) => menu.openFrom(item, e.currentTarget)}>⋯</button>
 *   {menu.element}
 *
 * 글자를 골랐거나 입력칸·링크 위에서 우클릭하면 브라우저 메뉴를 그대로 둔다 (shouldUseNativeMenu).
 * 메뉴 밖을 누르거나 스크롤·창 바꾸기·Esc 면 닫힌다. ↑↓ Home End 로 옮기고 Enter 로 고른다.
 */
export function useContextMenu<T>(build: (target: T) => MenuEntry[], options: Options = {}) {
  const [state, setState] = useState<OpenState<T> | null>(null)

  const close = useCallback(() => setState(null), [])

  const openAt = useCallback((target: T, x: number, y: number) => {
    setState({ target, x, y, anchor: null })
  }, [])

  /** ⋯ 버튼 같은 것 바로 아래에 띄운다. 같은 버튼으로 이미 열려 있으면 닫는다 */
  const openFrom = useCallback((target: T, el: Element) => {
    setState((cur) => {
      if (cur && cur.anchor === el) return null
      const r = el.getBoundingClientRect()
      return { target, x: r.left, y: r.bottom + 4, anchor: el }
    })
  }, [])

  /**
   * onContextMenu 에 바로 넣는 처리기.
   * links: false — 카드 자체가 링크라서 링크 위에서도 우리 메뉴를 띄울 때.
   * before — 띄우기 전에 할 일 (예: 그 항목 고르기).
   */
  const onContextMenu = useCallback(
    (target: T, opts: { links?: boolean; before?: () => void } = {}) =>
      (e: MouseEvent) => {
        if (e.defaultPrevented) return
        e.stopPropagation()
        if (shouldUseNativeMenu(e, { links: opts.links })) return
        e.preventDefault()
        opts.before?.()
        // 키보드(메뉴 키·Shift+F10)로 열면 좌표가 0 이라 그 칸 옆에 띄운다
        if (e.clientX === 0 && e.clientY === 0) {
          const r = (e.currentTarget as Element).getBoundingClientRect()
          setState({ target, x: r.left + 12, y: r.top + Math.min(r.height, 32), anchor: null })
        } else {
          setState({ target, x: e.clientX, y: e.clientY, anchor: null })
        }
      },
    [],
  )

  const element: ReactNode = state ? (
    <ContextMenu
      key={`${state.x},${state.y}`}
      x={state.x}
      y={state.y}
      anchor={state.anchor}
      entries={build(state.target)}
      label={options.label ?? '메뉴'}
      width={options.width ?? 200}
      onClose={close}
    />
  ) : null

  return { openAt, openFrom, onContextMenu, close, target: state?.target ?? null, element }
}

/** '링크 복사' 메뉴용: 앱 안 주소를 전체 주소로 복사하고 알림을 띄운다 */
export function useCopyLink() {
  const toast = useToast()
  return useCallback(
    (path: string) => {
      void copyText(absoluteUrl(path)).then((ok) =>
        toast(ok ? '링크를 복사했어요.' : '링크를 복사하지 못했어요. 주소창에서 직접 복사해 주세요.', {
          tone: ok ? 'default' : 'error',
        }),
      )
    },
    [toast],
  )
}

/** useContextMenu 가 돌려주는 것 (카드 컴포넌트에 넘길 때) */
export type ContextMenuControl<T> = Pick<ReturnType<typeof useContextMenu<T>>, 'openAt' | 'openFrom' | 'onContextMenu'>
