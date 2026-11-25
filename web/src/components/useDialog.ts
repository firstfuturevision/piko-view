import { useEffect, useRef, type RefObject } from 'react'

// 열린 대화 상자 쌓임. ESC 는 맨 위 하나만 닫는다 (확인 창 → 서랍 → 모달 순서로 하나씩)
type Entry = { onEscape: () => void }
const stack: Entry[] = []

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || stack.length === 0) return
  e.preventDefault()
  stack[stack.length - 1].onEscape()
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

/**
 * 대화 상자 접근성: 열릴 때 안쪽에 초점(첫 입력칸, 또는 data-autofocus), Tab 은 안에서만 돈다,
 * 닫히면 연 버튼으로 초점을 돌려준다, ESC 는 쌓인 것 중 맨 위만 onEscape 를 부른다.
 * 컴포넌트가 붙어 있는 동안 열린 것으로 본다.
 */
export function useDialog(ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  const escape = useRef(onEscape)
  useEffect(() => {
    escape.current = onEscape
  })

  useEffect(() => {
    const root = ref.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const entry: Entry = { onEscape: () => escape.current() }
    stack.push(entry)
    if (stack.length === 1) {
      window.addEventListener('keydown', onKeyDown)
      // 열려 있는 동안 뒤 화면은 스크롤되지 않는다 (대화 상자 안쪽만 스크롤)
      document.documentElement.style.overflow = 'hidden'
    }

    // 처음 초점: 이미 안쪽(autoFocus)이면 그대로
    if (root && !root.contains(document.activeElement)) {
      const preferred =
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        focusables(root).find((el) => el.matches('input, select, textarea, [contenteditable="true"]')) ??
        null
      ;(preferred ?? root).focus({ preventScroll: true })
    }

    function trap(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !root || stack[stack.length - 1] !== entry) return
      const list = focusables(root)
      if (list.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const cur = document.activeElement
      if (e.shiftKey && (cur === first || cur === root || !root.contains(cur))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (cur === last || !root.contains(cur))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trap)

    return () => {
      document.removeEventListener('keydown', trap)
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      if (stack.length === 0) {
        window.removeEventListener('keydown', onKeyDown)
        document.documentElement.style.overflow = ''
      }
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [ref])
}
