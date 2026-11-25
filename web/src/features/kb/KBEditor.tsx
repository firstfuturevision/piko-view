import { useRef, useState } from 'react'
import { api } from '../../api'
import MarkdownEditor from '../../components/MarkdownEditor'
import Modal from '../../components/Modal'
import type { EditAnchor } from '../../lib/editAnchor'
import { useKB } from './useKB'
import KBMarkdownView from './KBMarkdownView'

interface Props {
  /** 고칠 문서 (없으면 새 문서) */
  docId: string | null
  initialTitle: string
  initialBody: string
  parentId: string | null
  imported?: boolean
  /** 보기 화면에서 읽던 자리 */
  anchor?: EditAnchor | null
  /** anchor: 보기로 돌아갈 때 맞출 자리 */
  onSaved: (docId: string, anchor: EditAnchor | null) => void | Promise<void>
  onCancel: (anchor: EditAnchor | null) => void
}

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.pptx,.hwp,.hwpx,.txt,.csv,.zip'

/** 보던 자리에서 제목은 입력칸, 본문은 원문(Markdown) 편집칸으로 바뀐다. */
export default function KBEditor({ docId, initialTitle, initialBody, parentId, imported, anchor, onSaved, onCancel }: Props) {
  const { tree, pathText, toast, setDirty, loadTree, openInTree } = useKB()
  const [similar, setSimilar] = useState<Similar[] | null>(null)
  const answer = useRef<(go: boolean) => void>(undefined)

  /** 새 문서를 만들기 전에 비슷한 문서가 있으면 묻는다. 못 알아내면 그냥 만든다 */
  async function confirmNotDuplicate(title: string, body: string) {
    let found: Similar[]
    try {
      found = (await api.kbSimilarDraft(title, body)).similar
    } catch {
      return
    }
    if (found.length === 0) return
    setSimilar(found)
    const go = await new Promise<boolean>((resolve) => (answer.current = resolve))
    setSimilar(null)
    if (!go) throw new Error('저장하지 않았습니다. 비슷한 문서를 먼저 확인해 보세요.')
  }

  return (
    <>
    <MarkdownEditor
      initialTitle={initialTitle}
      initialBody={initialBody}
      bodyPlaceholder={'Markdown으로 작성하세요.\n[[ 를 입력하면 연결할 문서를 고를 수 있습니다.'}
      focusBody={!!docId}
      anchor={anchor}
      hint={imported ? '원본 파일은 바뀌지 않습니다' : undefined}
      notify={toast}
      onDirtyChange={setDirty}
      renderPreview={(body) => <KBMarkdownView text={body} />}
      attach={(files) => api.kbAttach(files)}
      attachAccept={ACCEPT}
      suggest={(q) =>
        tree
          .filter((x) => x.status !== 'superseded' && x.id !== docId && x.title.toLowerCase().includes(q))
          .map((x) => ({ id: x.id, title: x.title, hint: pathText(x.id) }))
      }
      onSave={async (title, body, at) => {
        if (!docId) await confirmNotDuplicate(title, body)
        const r = docId ? await api.kbUpdateContent(docId, title, body) : await api.kbCreateNote(title, body, parentId)
        setDirty(false)
        toast('저장했습니다.')
        if (parentId) openInTree(parentId)
        await loadTree()
        await onSaved(r.doc_id, at)
      }}
      onCancel={onCancel}
    />
    <Modal open={similar !== null} title="비슷한 문서가 이미 있습니다" onClose={() => answer.current?.(false)}>
      <p className="text-sm text-slate-600">
        같은 내용을 다룬 문서가 있으면 새로 만들지 말고 그 문서를 고쳐 주세요.
      </p>
      <ul className="mt-3 space-y-1.5">
        {similar?.map((d) => (
          <li key={d.doc_id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <a
              href={`/kb/doc/${d.doc_id}`}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate font-medium text-blue-700 hover:underline"
              title={d.path}
            >
              {d.title}
            </a>
            <span className="shrink-0 text-xs text-slate-400">비슷함 {Math.round(d.similarity * 100)}%</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={() => answer.current?.(false)}
          data-tip="저장하지 않고 편집으로 돌아갑니다. 위 문서를 먼저 열어 보세요"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
        >
          돌아가서 확인
        </button>
        <button
          onClick={() => answer.current?.(true)}
          data-tip="정말 다른 내용일 때만 새 문서로 저장하세요"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          그래도 새로 만들기
        </button>
      </div>
    </Modal>
    </>
  )
}

interface Similar {
  doc_id: string
  title: string
  path: string
  similarity: number
}
