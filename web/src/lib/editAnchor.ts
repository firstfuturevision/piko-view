import { marked } from 'marked'

/**
 * 보기 ↔ 편집을 오갈 때 읽던 자리를 잇는 기준점.
 * offset: Markdown 원문에서의 글자 위치, y: 그 내용이 화면(뷰포트)에 있던 높이.
 */
export interface EditAnchor {
  offset: number
  y: number
}

/** 렌더된 Markdown 의 최상위 블록(문단·제목·목록…)마다 원문에서 시작하는 위치 */
function blockOffsets(source: string): number[] {
  const offs: number[] = []
  let pos = 0
  for (const t of marked.lexer(source)) {
    // 빈 줄과 링크 정의는 화면에 블록을 만들지 않는다
    if (t.type !== 'space' && t.type !== 'def') offs.push(pos)
    pos += t.raw.length
  }
  return offs
}

/** 스크롤되는 가장 가까운 상위 요소 (없으면 문서 전체) */
export function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement
}

/**
 * 보기 화면에서 편집을 시작할 기준점.
 * 두 번 누른 곳이 있으면 그 블록, 없으면(편집 버튼) 화면 위쪽에 보이던 블록을 쓴다.
 */
export function anchorFromView(root: HTMLElement, source: string, point?: { target: EventTarget | null; clientY: number }): EditAnchor {
  const blocks = Array.from(root.children) as HTMLElement[]
  const offs = blockOffsets(source)
  const box = root.getBoundingClientRect()
  if (!blocks.length || blocks.length !== offs.length) {
    // 블록을 맞출 수 없는 글(일반 텍스트 등)은 높이 비율로 위치를 잡는다
    const y = point ? point.clientY : Math.max(box.top, 80)
    const ratio = Math.min(1, Math.max(0, (y - box.top) / Math.max(1, box.height)))
    return { offset: Math.round(source.length * ratio), y }
  }
  let i = -1
  if (point?.target instanceof Node) i = blocks.findIndex((b) => b.contains(point.target as Node))
  if (i < 0) i = Math.max(0, blocks.findIndex((b) => b.getBoundingClientRect().bottom > 80))
  return { offset: offs[i], y: blocks[i].getBoundingClientRect().top }
}

/** 편집을 마치고 보기로 돌아왔을 때, 커서가 있던 블록을 같은 높이에 맞춘다 */
export function scrollViewToAnchor(root: HTMLElement, source: string, anchor: EditAnchor) {
  const blocks = Array.from(root.children) as HTMLElement[]
  if (!blocks.length) return
  const offs = blockOffsets(source)
  let el: HTMLElement
  if (blocks.length === offs.length) {
    let i = 0
    while (i + 1 < offs.length && offs[i + 1] <= anchor.offset) i++
    el = blocks[i]
  } else {
    el = blocks[Math.min(blocks.length - 1, Math.round((blocks.length * anchor.offset) / Math.max(1, source.length)))]
  }
  scrollParent(root).scrollTop += el.getBoundingClientRect().top - anchor.y
}

/** 편집 칸 안에서 offset 글자가 있는 줄의 위쪽 위치(칸 위 끝 기준 px). 숨긴 복제 상자로 잰다 */
export function caretTop(ta: HTMLTextAreaElement, offset: number): number {
  const cs = getComputedStyle(ta)
  const div = document.createElement('div')
  const copy = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize',
  ] as const
  for (const k of copy) div.style[k] = cs[k]
  Object.assign(div.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-99999px',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: cs.wordBreak,
  })
  div.textContent = ta.value.slice(0, offset)
  const mark = document.createElement('span')
  mark.textContent = ta.value.slice(offset, offset + 1) || '.'
  div.appendChild(mark)
  document.body.appendChild(div)
  const top = mark.offsetTop
  div.remove()
  return top
}
