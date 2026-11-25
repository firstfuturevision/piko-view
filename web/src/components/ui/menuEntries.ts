import type { ReactNode } from 'react'

/** 메뉴 한 줄 */
export interface MenuItem {
  label: string
  onSelect: () => void
  /** 왼쪽 작은 아이콘 (글자·이모지) */
  icon?: ReactNode
  /** 빨간 글씨 (삭제 같은 것) */
  danger?: boolean
  disabled?: boolean
  /** 마우스를 올리면 뜨는 설명 (못 누를 때 까닭도 여기에) */
  tip?: string
  /** 오른쪽 작은 회색 글씨 (단축키·보기만 등) */
  hint?: string
  /** 지금 고른 것 (상태 목록 등) — 앞에 ✓ */
  checked?: boolean
}

/** 색 견본 줄: 동그란 견본을 줄지어 놓고, 누르면 메뉴를 닫고 onPick(key) */
export interface MenuSwatches {
  swatches: { key: string; label: string; /** CSS 색 */ color: string; checked?: boolean }[]
  onPick: (key: string) => void
}

/**
 * 메뉴에 넣는 것: 한 줄 · 'divider'(가는 줄) · { heading }(작은 제목) · { swatches }(색 견본 줄).
 * null·false·undefined 는 건너뛰어서 `cond && {...}` 처럼 쓸 수 있다.
 */
export type MenuEntry = MenuItem | 'divider' | { heading: string } | MenuSwatches | null | undefined | false

/** 브라우저 기본 메뉴(복사·붙여넣기·맞춤법·링크 열기)를 써야 하는 곳 */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-native-menu]'
const MEDIA_OR_LINK = 'a[href], img, video, audio'

/**
 * 우클릭에 우리 메뉴 대신 브라우저 메뉴를 둘지.
 * true: 글자를 골라 둠 · 입력칸/편집기 안 · [data-native-menu] 안 · (links 가 true 면) 링크·그림 위 · Shift 를 누른 채.
 * 카드 전체가 링크인 곳은 { links: false } 로 부르고 메뉴에 '링크 복사'를 넣는다.
 */
export function shouldUseNativeMenu(
  e: { target: EventTarget | null; shiftKey?: boolean },
  opts: { links?: boolean } = {},
): boolean {
  if (e.shiftKey) return true
  const t = e.target
  const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null
  if (!el) return false
  if (el.closest(EDITABLE)) return true
  if (opts.links !== false && el.closest(MEDIA_OR_LINK)) return true
  const sel = typeof window !== 'undefined' ? window.getSelection() : null
  if (sel && !sel.isCollapsed && sel.toString().trim() && sel.containsNode(el, true)) return true
  return false
}

/** 앱 안 주소(/docs/1 등)를 다른 사람에게 보낼 수 있는 전체 주소로 */
export function absoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

/** 새 탭에서 열기 */
export function openInNewTab(path: string) {
  window.open(path, '_blank', 'noopener')
}
