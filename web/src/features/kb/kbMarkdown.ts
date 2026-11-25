import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { kbFileUrl, type KBTreeItem } from '../../api'
import { MARKDOWN_PROSE_CLASS } from '../documents/markdown'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** [[문서 제목]] · [문서ID] 를 문서 링크로 바꾼다 (없는 제목은 빨간 점선). */
function linkify(md: string, byTitle: Record<string, KBTreeItem>, byId: Record<string, KBTreeItem>): string {
  return md
    .replace(/\[\[([^\]\n]+)\]\]/g, (_, t: string) => {
      const d = byTitle[t.trim()]
      return d
        ? `<a class="kb-doclink" href="/kb/doc/${d.id}" data-kb-doc="${d.id}">${esc(t)}</a>`
        : `<span class="kb-missing" title="'${esc(t)}' 문서가 없습니다">${esc(t)}</span>`
    })
    .replace(
      /\[((?:d|w|n)_[0-9a-f]{10})\]/g,
      (_, id: string) => `<a class="kb-doclink" href="/kb/doc/${id}" data-kb-doc="${id}">${esc(byId[id]?.title || id)}</a>`,
    )
}

/** KB 본문 Markdown → 안전한 HTML. 모든 출력은 DOMPurify 로 정제한다. */
export function renderKBMarkdown(
  text: string,
  byTitle: Record<string, KBTreeItem>,
  byId: Record<string, KBTreeItem>,
): string {
  const div = document.createElement('div')
  div.innerHTML = DOMPurify.sanitize(marked.parse(linkify(text || '', byTitle, byId), { breaks: true }) as string)
  div.querySelectorAll<HTMLAnchorElement>("a[href^='http']").forEach((a) => {
    a.target = '_blank'
    a.rel = 'noopener'
  })
  // 첨부 파일 (PDF 등): 로그인이 필요한 API 경로로 바꾸고, 누르면 새 탭에서 열리거나 내려받아진다
  div.querySelectorAll<HTMLAnchorElement>("a[href^='files/']").forEach((a) => {
    a.href = kbFileUrl(a.getAttribute('href')!)
    a.classList.add('kb-attach')
    a.target = '_blank'
    a.rel = 'noopener'
    a.insertAdjacentText('afterbegin', '📎 ')
  })
  div.querySelectorAll<HTMLImageElement>("img[src^='files/']").forEach((img) => {
    img.src = kbFileUrl(img.getAttribute('src')!)
    img.loading = 'lazy'
  })
  return div.innerHTML
}

/** 공통 Markdown 스타일 + KB 전용 링크·첨부·이미지 스타일 */
export const KB_PROSE_CLASS =
  `${MARKDOWN_PROSE_CLASS} ` +
  '[&_.kb-doclink]:rounded [&_.kb-doclink]:bg-blue-50 [&_.kb-doclink]:px-1 [&_.kb-doclink]:text-blue-700 [&_.kb-doclink]:no-underline hover:[&_.kb-doclink]:bg-blue-100 ' +
  '[&_.kb-missing]:border-b [&_.kb-missing]:border-dashed [&_.kb-missing]:border-red-400 [&_.kb-missing]:text-red-500 ' +
  // 표 칸은 글자 단위로 쪼개지 않는다: 좁은 화면에서는 표가 제 칸(가로 스크롤) 안에서 넘어가게 둔다
  '[&_th]:whitespace-nowrap [&_td]:[overflow-wrap:normal] [&_td]:min-w-16 ' +
  '[&_.kb-attach]:inline-flex [&_.kb-attach]:items-center [&_.kb-attach]:rounded-full [&_.kb-attach]:border [&_.kb-attach]:border-slate-300 [&_.kb-attach]:bg-white [&_.kb-attach]:px-2.5 [&_.kb-attach]:py-0.5 [&_.kb-attach]:text-xs [&_.kb-attach]:text-slate-700 [&_.kb-attach]:no-underline'
