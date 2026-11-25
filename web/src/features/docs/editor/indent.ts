import { Extension, type CommandProps } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      /** 들여쓰기: 목록이면 한 단계 안으로, 문단이면 왼쪽 여백을 늘린다 */
      indent: () => ReturnType
      /** 내어쓰기 */
      outdent: () => ReturnType
    }
  }
}

const MAX = 8
const TYPES = ['paragraph', 'heading']

/** 문단·제목 들여쓰기 (indent 0~8 단계, 한 단계 = 2em). 목록 안에서는 목록 단계를 바꾼다 */
export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
            renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent } : {}),
          },
        },
      },
    ]
  },

  addCommands() {
    const change =
      (delta: number) =>
      () =>
      ({ editor, state, tr, dispatch, commands }: CommandProps) => {
        for (const item of ['taskItem', 'listItem']) {
          if (editor.isActive(item)) return delta > 0 ? commands.sinkListItem(item) : commands.liftListItem(item)
        }
        const { from, to } = state.selection
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!TYPES.includes(node.type.name)) return
          const cur = Number(node.attrs.indent) || 0
          const next = Math.max(0, Math.min(MAX, cur + delta))
          if (next !== cur) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
            changed = true
          }
          return false
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }
    return {
      indent: change(1),
      outdent: change(-1),
    }
  },

  addKeyboardShortcuts() {
    // 표 안에서는 Tab 이 다음 칸으로, 목록 안에서는 목록 단계 바꾸기로 쓰인다
    const plain = () => !this.editor.isActive('table') && !this.editor.isActive('listItem') && !this.editor.isActive('taskItem')
    return {
      Tab: () => (plain() ? this.editor.commands.indent() || true : false),
      'Shift-Tab': () => (plain() ? this.editor.commands.outdent() || true : false),
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    }
  },
})
