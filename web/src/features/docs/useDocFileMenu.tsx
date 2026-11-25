import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type DocSummary } from '../../api'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { openInNewTab, type MenuEntry } from '../../components/ui/menuEntries'
import { useContextMenu, useCopyLink } from '../../components/ui/useContextMenu'
import { docPath, errorText, KIND_LABEL } from './docUtils'
import SaveTemplateDialog from './SaveTemplateDialog'
import ShareDialog from './ShareDialog'

/** 지울 수 있는지: 프로젝트 파일은 누구나, 개인 파일은 만든 사람만 (서버 규칙과 같다) */
export const canDeleteDoc = (d: DocSummary) => d.project !== null || d.can_manage

/** 지울 때 확인 창에 덧붙이는 말 */
export const DOC_DELETE_WARNING = '댓글과 넣은 이미지도 함께 지워지고, 되돌릴 수 없습니다.'

/**
 * 문서·슬라이드 카드의 메뉴 (우클릭 또는 ⋯ 버튼):
 * 열기·새 탭에서 열기·링크 복사·이름 바꾸기·복제·공유·옮기기·템플릿으로 저장·삭제.
 * onContextMenu(파일)·openFrom(파일, ⋯ 버튼)·openAt(파일, x, y) 로 띄우고, element 를 화면 어딘가에 그려 둔다.
 */
export function useDocFileMenu(onChanged: () => void, onError: (message: string) => void) {
  const navigate = useNavigate()
  const copyLink = useCopyLink()
  const [renaming, setRenaming] = useState<DocSummary | null>(null)
  const [name, setName] = useState('')
  const [sharing, setSharing] = useState<DocSummary | null>(null)
  const [templating, setTemplating] = useState<DocSummary | null>(null)
  const [pendingDelete, setPendingDelete] = useState<DocSummary | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(job: () => Promise<unknown>, fail: string) {
    setBusy(true)
    try {
      await job()
      onChanged()
    } catch (err) {
      onError(errorText(err, fail))
    } finally {
      setBusy(false)
    }
  }

  const menu = useContextMenu(
    (m: DocSummary): MenuEntry[] => {
      const personal = m.project === null
      const canDelete = canDeleteDoc(m)
      return [
        { label: '열기', icon: '↗', onSelect: () => navigate(docPath(m)) },
        { label: '새 탭에서 열기', icon: '⧉', onSelect: () => openInNewTab(docPath(m)) },
        { label: '링크 복사', icon: '🔗', onSelect: () => copyLink(docPath(m)), tip: '볼 수 있는 사람에게 보낼 주소를 복사합니다' },
        'divider',
        {
          label: '이름 바꾸기',
          icon: '✎',
          onSelect: () => {
            setName(m.title)
            setRenaming(m)
          },
        },
        {
          label: '복제',
          icon: '⎘',
          tip: '같은 위치에 사본을 만듭니다',
          onSelect: () => void run(() => api.duplicateDoc(m.id), '복제하지 못했습니다.'),
        },
        {
          label: '공유',
          icon: '👥',
          tip: personal ? '함께 볼 사람을 고르거나 링크를 복사합니다' : '프로젝트 파일은 모두가 봅니다. 링크를 복사합니다',
          onSelect: () => setSharing(m),
        },
        {
          label: '템플릿으로 저장',
          icon: '★',
          tip: '이 내용을 새로 만들 때 고를 수 있는 틀로 저장합니다',
          onSelect: () => setTemplating(m),
        },
        'divider',
        {
          label: '삭제',
          icon: '🗑',
          danger: true,
          disabled: !canDelete,
          tip: canDelete ? undefined : '공유받은 파일은 만든 사람만 삭제할 수 있습니다',
          onSelect: () => setPendingDelete(m),
        },
      ]
    },
    { label: '파일 메뉴', width: 200 },
  )

  const element: ReactNode = (
    <>
      {menu.element}
      <Modal open={renaming !== null} title="이름 바꾸기" onClose={() => setRenaming(null)} widthClass="max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const d = renaming
            if (!d) return
            void run(() => api.updateDoc(d.id, { title: name.trim() || d.title }), '이름을 바꾸지 못했습니다.').then(() =>
              setRenaming(null),
            )
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="이름"
            maxLength={200}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRenaming(null)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </form>
      </Modal>
      <ShareDialog doc={sharing} onClose={() => setSharing(null)} onChanged={onChanged} />
      <SaveTemplateDialog doc={templating} onClose={() => setTemplating(null)} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`${pendingDelete ? KIND_LABEL[pendingDelete.kind] : '문서'} 삭제`}
        message={
          pendingDelete
            ? `'${pendingDelete.title}'을(를) 삭제할까요?\n${DOC_DELETE_WARNING}`
            : ''
        }
        onConfirm={() => {
          const d = pendingDelete
          setPendingDelete(null)
          if (d) void run(() => api.deleteDoc(d.id), '삭제하지 못했습니다.')
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )

  return { openAt: menu.openAt, openFrom: menu.openFrom, onContextMenu: menu.onContextMenu, element }
}
