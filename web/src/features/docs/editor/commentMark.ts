import { Mark, mergeAttributes, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { FileComment } from '../../../api'

/**
 * 댓글이 붙은 글자에 다는 표시(mark). 댓글 anchor 는 {"mark": "<id>"} 이고,
 * 표시가 문서(Yjs) 안에 들어 있어 글이 고쳐져도 함께 움직이고 다른 사람에게도 보인다.
 * 같은 글자에 여러 댓글이 겹칠 수 있다 (excludes: '').
 * 색칠은 화면이 정한다 (열린 댓글만 노랗게, 해결된 것은 칠하지 않음).
 */
export const CommentMark = Mark.create({
  name: 'comment',
  excludes: '',
  // 댓글 단 글 끝에 이어 쓴 글은 댓글에 들어가지 않는다
  inclusive: false,
  spanning: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => ({ 'data-comment-id': attrs.id }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'doc-comment' }), 0]
  },
})

/** 문서에서 댓글 표시 id → 그 글자 범위 (처음~끝) */
export function commentRanges(doc: PMNode): Map<string, { from: number; to: number; text: string }> {
  const map = new Map<string, { from: number; to: number; text: string }>()
  doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const m of node.marks) {
      if (m.type.name !== 'comment' || !m.attrs.id) continue
      const id = String(m.attrs.id)
      const cur = map.get(id)
      const end = pos + node.nodeSize
      if (cur) {
        cur.to = Math.max(cur.to, end)
        cur.from = Math.min(cur.from, pos)
        if (cur.text.length < 200) cur.text += node.text ?? ''
      } else {
        map.set(id, { from: pos, to: end, text: node.text ?? '' })
      }
    }
  })
  return map
}

/** 문서 안의 한 댓글 표시를 모두 지운다 (댓글을 지울 때) */
export function removeCommentMark(state: EditorState, id: string) {
  const type = state.schema.marks.comment
  const tr = state.tr
  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find((m) => m.type === type && m.attrs.id === id)
    if (mark) tr.removeMark(pos, pos + node.nodeSize, mark)
  })
  return tr
}

// ---------------------------------------------------------------- 쓰는 중인 댓글 자리

/** 댓글을 쓰는 동안 고른 글자를 연하게 칠해 두고, 다른 사람이 글을 고쳐도 자리를 따라간다 */
export const draftKey = new PluginKey<{ from: number; to: number } | null>('commentDraft')

export function draftPlugin() {
  return new Plugin<{ from: number; to: number } | null>({
    key: draftKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(draftKey) as { from: number; to: number } | null | undefined
        if (meta !== undefined) return meta
        if (!value || !tr.docChanged) return value
        const from = tr.mapping.map(value.from, 1)
        const to = tr.mapping.map(value.to, -1)
        return to > from ? { from, to } : null
      },
    },
    props: {
      decorations(state) {
        const v = draftKey.getState(state)
        if (!v) return null
        return DecorationSet.create(state.doc, [Decoration.inline(v.from, v.to, { class: 'doc-comment-draft' })])
      },
    },
  })
}

/** 댓글 표시 id: 영문·숫자·-_ 만 (화면 CSS 선택자에 그대로 쓰므로) */
const SAFE_ID = /^[\w-]{1,64}$/

/** 댓글의 anchor 에서 표시 id 를 꺼낸다 (모양이 다르면 빈 글) */
export function markOf(c: Pick<FileComment, 'anchor'>): string {
  const m = c.anchor?.mark
  return typeof m === 'string' && SAFE_ID.test(m) ? m : ''
}

/** 지금 고른 글로 댓글 쓰기를 시작한다 (고른 글이 없으면 false) */
export function startCommentDraft(editor: Editor): boolean {
  const { from, to, empty } = editor.state.selection
  if (empty) return false
  editor.view.dispatch(editor.state.tr.setMeta(draftKey, { from, to }))
  return true
}
