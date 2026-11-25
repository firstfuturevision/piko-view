import { Extension, getSchema, type AnyExtension } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { CommentMark, draftPlugin } from './commentMark'
import { Indent } from './indent'

/**
 * 문서 편집기의 내용 규칙(노드·마크). 공동 편집 연결(Collaboration·커서)은 화면에서 더한다.
 * 같은 목록으로 schema 를 만들어 snapshot 을 Yjs 로 옮길 때도 쓴다 — 바꾸면 둘 다 바뀐다.
 * 모양은 server/apps/docs/formats.py 의 '문서' 부분과 맞춘다.
 */
/** 표 칸 바탕색 (머리글·합계 줄을 칠한다). 칸 attrs.backgroundColor, HTML 은 style 로 */
const cellBackground = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-bg') || el.style.backgroundColor || null,
    renderHTML: (attrs: { backgroundColor?: string | null }) =>
      attrs.backgroundColor ? { 'data-bg': attrs.backgroundColor, style: `background-color: ${attrs.backgroundColor}` } : {},
  },
}
/** 테두리 없는 칸 (견적서 머리처럼 제목 칸과 상자를 나란히 둘 때). 맞닿은 칸의 테두리는 그대로 보인다 */
const cellBorderless = {
  borderless: {
    default: false,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-nb') === '1',
    renderHTML: (attrs: { borderless?: boolean }) => (attrs.borderless ? { 'data-nb': '1' } : {}),
  },
}
const ColorCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground, ...cellBorderless } } })
const ColorHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellBackground, ...cellBorderless } } })

export function contentExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      // 되돌리기는 공동 편집(Yjs)이 사람마다 따로 맡는다
      undoRedo: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      codeBlock: { HTMLAttributes: { class: 'doc-code' } },
    }),
    TextStyle,
    Color,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node, checked) => `할 일 ${checked ? '완료' : '미완료'}: ${node.textContent || '빈 항목'}` },
    }),
    TableKit.configure({ table: { resizable: true, HTMLAttributes: { class: 'doc-table' } }, tableCell: false, tableHeader: false }),
    ColorCell,
    ColorHeader,
    Image.configure({
      inline: false,
      allowBase64: false,
      resize: {
        enabled: true,
        directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'],
        minWidth: 40,
        minHeight: 30,
        alwaysPreserveAspectRatio: true,
      },
    }),
    Typography.configure({
      // 따옴표를 둥근 따옴표로 바꾸지 않는다 (코드·숫자 표기에 방해)
      openDoubleQuote: false,
      closeDoubleQuote: false,
      openSingleQuote: false,
      closeSingleQuote: false,
    }),
    CommentMark,
    Indent,
  ]
}

/** 화면에서만 쓰는 것: 안내 글·글자 수·쓰는 중인 댓글 자리 */
export function uiExtensions(): AnyExtension[] {
  return [
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === 'heading' ? '제목' : '여기에 내용을 입력하세요. 위 도구 막대로 꾸미고, 글을 골라 댓글을 답니다.',
      showOnlyCurrent: true,
    }),
    CharacterCount,
    Extension.create({ name: 'commentDraft', addProseMirrorPlugins: () => [draftPlugin()] }),
  ]
}

let schemaCache: ReturnType<typeof getSchema> | null = null

/** snapshot(JSON) ↔ Yjs 변환에 쓰는 schema */
export function docSchema() {
  schemaCache ??= getSchema(contentExtensions())
  return schemaCache
}
