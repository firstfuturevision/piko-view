import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type DocKind, type DocSummary, type FileTemplateSummary } from '../../api'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import { docPath, errorText, KIND_LABEL } from './docUtils'

interface Props {
  open: boolean
  kind: DocKind
  onClose: () => void
  /** 만든 뒤 할 일 (없으면 편집기로 간다) */
  onCreated?: (doc: DocSummary) => void
}

/** 이름을 따로 붙일 것 없는 기본 빈 템플릿 */
const isBlank = (t: FileTemplateSummary) => t.builtin && (t.name === '빈 문서' || t.name === '기본')

/** 템플릿 카드 그림: 미리보기가 없으면 종류에 맞는 간단한 틀을 그린다 */
function TemplatePreview({ t }: { t: FileTemplateSummary }) {
  if (t.thumbnail) return <img src={t.thumbnail} alt="" className="h-full w-full object-cover object-top" />
  if (t.kind === 'slides') {
    return (
      <div className="flex h-full w-full items-center justify-center p-3">
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded border border-slate-200 bg-white">
          <span className="h-1.5 w-1/2 rounded bg-slate-300" />
          <span className="h-1 w-1/3 rounded bg-slate-200" />
        </div>
      </div>
    )
  }
  const blank = isBlank(t)
  return (
    <div className="flex h-full w-full justify-center px-4 pt-3">
      <div className="w-full space-y-1 rounded-t border border-b-0 border-slate-200 bg-white px-2.5 pt-2.5">
        {blank ? (
          <span className="mt-6 block text-center text-xl font-light text-slate-300">+</span>
        ) : (
          <>
            <span className="block h-1.5 w-2/3 rounded bg-slate-400" />
            <span className="block h-1 w-full rounded bg-slate-200" />
            <span className="block h-1 w-5/6 rounded bg-slate-200" />
            <span className="mt-1.5 block h-1 w-1/3 rounded bg-blue-300" />
            <span className="block h-1 w-full rounded bg-slate-200" />
            <span className="block h-1 w-3/4 rounded bg-slate-200" />
          </>
        )}
      </div>
    </div>
  )
}

/** 새 문서 만들기: 이름, 템플릿. 만든 문서는 내 파일(공유는 따로) */
export default function NewDocDialog(props: Props) {
  // 열 때마다 처음 상태로
  return props.open ? <NewDocBody {...props} /> : null
}

function NewDocBody({ kind, onClose, onCreated }: Props) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [templates, setTemplates] = useState<FileTemplateSummary[] | null>(null)
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<FileTemplateSummary | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    api
      .listTemplates(kind)
      .then((t) => {
        if (!alive) return
        // 기본 템플릿 먼저, 그다음 사람들이 만든 것 (최근 것 먼저)
        const sorted = [...t].sort((a, b) =>
          a.builtin !== b.builtin ? (a.builtin ? -1 : 1) : a.builtin ? a.id - b.id : b.id - a.id,
        )
        setTemplates(sorted)
        setTemplateId((cur) => (cur !== null && sorted.some((x) => x.id === cur) ? cur : (sorted[0]?.id ?? null)))
      })
      .catch((e) => alive && setError(errorText(e, '템플릿을 불러오지 못했습니다.')))
    return () => {
      alive = false
    }
  }, [kind, version])

  const label = KIND_LABEL[kind]
  const picked = templates?.find((t) => t.id === templateId)
  const canSubmit = !busy

  async function create() {
    if (!canSubmit) return
    setBusy(true)
    setError('')
    const name = title.trim() || (picked && !isBlank(picked) ? picked.name : `제목 없는 ${label}`)
    const target = null
    try {
      const doc = picked
        ? ((await api.createFromTemplate(picked.id, { title: name, project: target })) as DocSummary)
        : await api.createDoc({ kind, title: name, project: target })
      onClose()
      if (onCreated) onCreated(doc)
      else navigate(docPath(doc))
    } catch (e) {
      setError(errorText(e, `${label}를 만들지 못했습니다.`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal open title={`새 ${label}`} onClose={onClose} widthClass="max-w-2xl">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
          className="space-y-4 text-sm text-slate-600"
        >
          <label className="block">
            <span className="font-medium text-slate-700">이름</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={picked && !isBlank(picked) ? `비우면 '${picked.name}'` : '예: 3월 정기 회의'}
              data-tip="목록과 편집기 맨 위에 보일 이름입니다. 나중에 바꿀 수 있습니다"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            />
          </label>

          <div>
            <p className="font-medium text-slate-700">템플릿</p>
            {templates === null ? (
              <p className="py-6 text-center text-slate-400">불러오는 중...</p>
            ) : (
              <ul className="mt-1.5 grid max-h-[20rem] grid-cols-2 gap-3 overflow-y-auto p-0.5 sm:grid-cols-4">
                {templates.map((t) => (
                  <li key={t.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setTemplateId(t.id)}
                      onDoubleClick={() => {
                        setTemplateId(t.id)
                        void create()
                      }}
                      aria-pressed={t.id === templateId}
                      data-tip={t.description || t.name}
                      className={`block w-full overflow-hidden rounded-xl border text-left transition ${
                        t.id === templateId
                          ? 'border-blue-500 ring-2 ring-blue-500/30'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                        <TemplatePreview t={t} />
                      </div>
                      <div className="px-2.5 py-2">
                        <p className="truncate text-[13px] font-medium text-slate-800">{t.name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {t.builtin ? '기본' : t.owner_name ? `${t.owner_name} 님이 만듦` : '사용자 템플릿'}
                        </p>
                      </div>
                    </button>
                    {t.can_manage && (
                      <button
                        type="button"
                        aria-label={`${t.name} 템플릿 삭제`}
                        data-tip="내가 만든 템플릿을 삭제합니다 (이미 만든 파일은 그대로)"
                        onClick={() => setPendingDelete(t)}
                        className="absolute top-1.5 right-1.5 hidden rounded-md bg-white/90 px-1.5 text-xs text-slate-500 shadow-sm ring-1 ring-slate-200 group-hover:block hover:text-red-600"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50">
              취소
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-tip={`고른 템플릿으로 ${label}를 만들고 엽니다`}
              className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '만드는 중...' : '만들고 열기'}
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="템플릿 삭제"
        message={pendingDelete ? `'${pendingDelete.name}' 템플릿을 삭제할까요?\n이 템플릿으로 이미 만든 파일은 그대로 남습니다.` : ''}
        onConfirm={() => {
          const t = pendingDelete
          setPendingDelete(null)
          if (t)
            api
              .deleteTemplate(t.id)
              .then(() => setVersion((v) => v + 1))
              .catch((e) => setError(errorText(e, '템플릿을 삭제하지 못했습니다.')))
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
