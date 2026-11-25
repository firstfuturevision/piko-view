import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

/** 왼쪽 개요: 문서의 제목들. 누르면 그 자리로 간다 */
export default function Outline({ editor }: { editor: Editor }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const out: { level: number; text: string; pos: number }[] = []
      e.state.doc.forEach((node, pos) => {
        if (node.type.name === 'heading') out.push({ level: Number(node.attrs.level) || 1, text: node.textContent, pos })
      })
      return out
    },
  })

  function go(pos: number) {
    const dom = editor.view.nodeDOM(pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: 'smooth', block: 'start' })
    editor.chain().focus().setTextSelection(pos + 1).run()
  }

  return (
    <nav aria-label="개요" className="text-[13px]">
      <p className="mb-2 px-2 text-[11px] font-semibold tracking-wide text-slate-400">개요</p>
      {headings.length === 0 ? (
        <p className="px-2 text-xs leading-relaxed text-slate-400">
          제목(제목 1~3)을 넣으면 여기에 목차가 생깁니다.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {headings.map((h) => (
            <li key={h.pos}>
              <button
                type="button"
                onClick={() => go(h.pos)}
                data-tip="이 제목으로 갑니다"
                style={{ paddingLeft: `${0.5 + (h.level - 1) * 0.85}rem` }}
                className={`block w-full truncate rounded-md py-1 pr-2 text-left transition hover:bg-slate-200/60 ${
                  h.level === 1 ? 'font-semibold text-slate-800' : 'text-slate-600'
                }`}
              >
                {h.text || <span className="text-slate-400">(빈 제목)</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
