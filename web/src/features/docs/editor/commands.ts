import { Extension, type Editor } from '@tiptap/core'

/** 서식 지우기: 굵게·색·크기 등을 없애되 댓글 표시와 링크는 남긴다 */
export function clearFormatting(editor: Editor) {
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const { from, to } = state.selection
      for (const type of Object.values(state.schema.marks)) {
        if (type.name !== 'comment' && type.name !== 'link') tr.removeMark(from, to, type)
      }
      tr.setStoredMarks([])
      return true
    })
    .run()
}

export type ShortcutName = 'link' | 'comment' | 'print' | 'save'

/** 편집기 단축키를 화면에 알리는 DOM 이벤트 이름 (detail: ShortcutName) */
export const SHORTCUT_EVENT = 'doc-shortcut'

/**
 * 구글 문서와 같은 단축키 (나머지 Ctrl+B/I/U, Ctrl+Alt+1~3, Ctrl+Shift+7/8 은 기본 확장이 맡는다).
 * 링크 창·댓글처럼 화면이 할 일은 편집기 DOM 에 SHORTCUT_EVENT 로 알린다.
 */
export const DocShortcuts = Extension.create({
  name: 'docShortcuts',
  addKeyboardShortcuts() {
    const emit = (name: ShortcutName) => () => {
      this.editor.view.dom.dispatchEvent(new CustomEvent(SHORTCUT_EVENT, { detail: name }))
      return true
    }
    return {
      'Mod-k': emit('link'),
      'Mod-Alt-m': emit('comment'),
      'Mod-p': emit('print'),
      'Mod-s': emit('save'),
      'Mod-\\': () => {
        clearFormatting(this.editor)
        return true
      },
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),
      'Mod-y': () => this.editor.commands.redo(),
    }
  },
})
