import type { MouseEvent } from 'react'
import { anchorFromView, type EditAnchor } from '../../lib/editAnchor'
import { useKB } from './useKB'
import { KB_PROSE_CLASS, renderKBMarkdown } from './kbMarkdown'

interface Props {
  text: string
  className?: string
  /** 두 번 누른 자리에서 편집을 시작한다 */
  onDoubleClick?: (anchor: EditAnchor) => void
}

/** KB Markdown 본문. 문서 링크([[제목]])는 새로고침 없이 KB 안에서 이동한다. */
export default function KBMarkdownView({ text, className = '', onDoubleClick }: Props) {
  const { byTitle, byId, go } = useKB()

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-kb-doc]')
    if (!a || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    go(`/kb/doc/${a.dataset.kbDoc}`)
  }

  return (
    <div
      data-md-root
      className={`${KB_PROSE_CLASS} ${className}`}
      onClick={handleClick}
      onDoubleClick={(e) => {
        if (!onDoubleClick || (e.target as HTMLElement).closest('a')) return
        onDoubleClick(anchorFromView(e.currentTarget, text, { target: e.target, clientY: e.clientY }))
      }}
      dangerouslySetInnerHTML={{ __html: renderKBMarkdown(text, byTitle, byId) }}
    />
  )
}
