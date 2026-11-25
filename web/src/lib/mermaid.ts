/**
 * Markdown 의 ```mermaid 코드 블록을 그림으로 바꾼다.
 *
 * 본문은 여러 화면(지식 베이스·문서 등)이 각자 innerHTML 로 넣으므로, 화면마다 고치지 않고
 * 페이지 전체를 지켜보다가 새로 나타난 `pre > code.language-mermaid` 를 찾아 그린다.
 * 편집 중인 영역(contenteditable)은 건드리지 않는다. mermaid 는 처음 쓸 때만 불러온다.
 */
type Mermaid = typeof import('mermaid').default

const SELECTOR = 'pre > code.language-mermaid'
let loader: Promise<Mermaid> | null = null
let seq = 0

function loadMermaid(): Promise<Mermaid> {
  loader ??= import('mermaid').then(({ default: m }) => {
    // strict: 그림 안의 HTML·스크립트·클릭 동작을 막는다
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', fontFamily: 'inherit' })
    return m
  })
  return loader
}

/** mermaid 글을 SVG 문자열로 그린다 (화면이 직접 그림을 넣을 때). 문법 오류면 예외 */
export async function renderMermaidSvg(source: string): Promise<string> {
  const id = `mermaid-${++seq}`
  try {
    const mermaid = await loadMermaid()
    const { svg } = await mermaid.render(id, source)
    return svg
  } catch (e) {
    document.getElementById(`d${id}`)?.remove()
    throw e
  }
}

async function renderBlock(code: HTMLElement) {
  const pre = code.parentElement
  if (!pre || pre.dataset.mermaid) return
  pre.dataset.mermaid = 'pending'
  const source = code.textContent ?? ''
  const id = `mermaid-${++seq}`
  try {
    const mermaid = await loadMermaid()
    const { svg } = await mermaid.render(id, source)
    if (!pre.isConnected) return
    const figure = document.createElement('div')
    figure.className = 'mermaid-figure my-5 overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 text-center'
    figure.innerHTML = svg
    pre.replaceWith(figure)
  } catch (e) {
    // 실패하면 mermaid 가 body 끝에 남기는 임시 그림을 치운다
    document.getElementById(`d${id}`)?.remove()
    // 문법 오류: 원래 코드는 그대로 두고 위에 이유를 붙인다
    if (!pre.isConnected) return
    pre.dataset.mermaid = 'error'
    const note = document.createElement('p')
    note.className = 'mermaid-error mt-5 -mb-3 text-xs text-red-500'
    note.textContent = `다이어그램을 그리지 못했습니다: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`
    pre.before(note)
  }
}

function scan(root: ParentNode) {
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach((code) => {
    if (code.closest('[contenteditable="true"]')) return
    void renderBlock(code)
  })
}

let started = false

/** 앱 시작 때 한 번 부른다. */
export function startMermaid() {
  if (started || typeof MutationObserver === 'undefined') return
  started = true
  scan(document.body)
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof Element) {
          if (n.matches(SELECTOR)) scan(n.parentElement ?? n)
          else scan(n)
        }
      })
    }
  }).observe(document.body, { childList: true, subtree: true })
}
