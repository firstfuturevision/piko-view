import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, ApiError, type KBDocument } from '../../api'
import ConfirmDialog from '../../components/ConfirmDialog'
import { anchorFromView, scrollViewToAnchor, type EditAnchor } from '../../lib/editAnchor'
import { useKB } from './useKB'
import { API_BASE } from '../../api/client'
import { AUTHORED, fileName, fmtDate, STATUS, TYPE, WHO } from './kbLabels'
import KBEditor from './KBEditor'
import KBMarkdownView from './KBMarkdownView'

type Mode = 'view' | 'edit'

/** 가져온 문서의 원본 파일 주소 (PDF 는 화면 안에서 열린다) */
const rawUrl = (id: string) => `${API_BASE}/kb/documents/${encodeURIComponent(id)}/raw/`

export default function KBDocPage({ mode }: { mode: Mode }) {
  const { id = '' } = useParams()
  const { go, toast, loadTree, kids, openInTree } = useKB()
  const childFile = useRef<HTMLInputElement>(null)
  const [doc, setDoc] = useState<KBDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(mode === 'edit')
  const [tagInput, setTagInput] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 보기 ↔ 편집을 오갈 때 읽던 자리를 잇는다
  const [editAnchor, setEditAnchor] = useState<EditAnchor | null>(null)
  const returnAnchor = useRef<EditAnchor | null>(null)
  const article = useRef<HTMLElement>(null)

  const viewRoot = () => article.current?.querySelector<HTMLElement>('[data-md-root]') ?? null

  /** 편집 시작: 두 번 누른 자리, 없으면(편집 버튼) 화면에 보이던 자리부터 */
  function startEdit(at?: EditAnchor) {
    const root = viewRoot()
    setEditAnchor(at ?? (root && doc ? anchorFromView(root, doc.body) : null))
    setEditing(true)
  }

  function finishEdit(at: EditAnchor | null) {
    returnAnchor.current = at
    setEditing(false)
  }

  // 편집을 마치고 보기로 돌아오면 커서가 있던 자리를 같은 높이에 둔다
  useLayoutEffect(() => {
    const at = returnAnchor.current
    const root = viewRoot()
    if (editing || !at || !root || !doc) return
    returnAnchor.current = null
    scrollViewToAnchor(root, doc.body, at)
  }, [editing, doc])

  const load = useCallback(async () => {
    try {
      setDoc(await api.kbDocument(id))
      setError(null)
    } catch (e) {
      setDoc(null)
      setError(e instanceof ApiError && e.status === 404 ? '문서가 없습니다. 삭제되었을 수 있습니다.' : String(e))
    }
  }, [id])

  // 주소의 보기/편집 모드가 바뀌면 따른다 (렌더 중에 맞춘다)
  const [modeSeen, setModeSeen] = useState(mode)
  if (modeSeen !== mode) {
    setModeSeen(mode)
    setEditing(mode === 'edit')
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 응답(await) 뒤에만 상태를 바꾼다
    void load()
  }, [load, mode])

  useEffect(() => {
    if (doc) document.title = `${doc.title} · 지식 베이스`
    return () => {
      document.title = 'board'
    }
  }, [doc])

  async function act(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn()
      toast(msg)
      await loadTree()
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '처리하지 못했습니다.')
    }
  }

  /** 이 문서 아래에 파일을 올린다 (사이드바에 끌어다 놓기와 같은 가져오기) */
  async function uploadUnder(files: File[]) {
    if (!doc) return
    toast(`${files.length}개 파일을 올리는 중…`)
    try {
      const res = await api.kbUpload(files, doc.id)
      openInTree(doc.id)
      await loadTree()
      const ok = res.filter((r) => r.status === 'added' || r.status === 'updated').length
      const err = res.find((r) => r.status === 'error')
      toast(err && !ok ? err.error! : `${ok}개 올림${res.length > ok ? ` · ${res.length - ok}개는 이미 있거나 오류` : ''}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '올리지 못했습니다.')
    }
  }

  async function handleDelete() {
    if (!doc) return
    try {
      await api.kbDelete(doc.id)
      toast('삭제했습니다.')
      await loadTree()
      go(doc.ancestors.length ? `/kb/doc/${doc.ancestors[doc.ancestors.length - 1].id}` : '/kb', { replace: true })
    } catch (e) {
      toast(e instanceof Error ? e.message : '삭제하지 못했습니다.')
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-slate-500 sm:px-8">
        {error}
        <br />
        <button onClick={() => go('/kb')} className="mt-3 text-blue-600 hover:underline">
          홈으로
        </button>
      </div>
    )
  }
  if (!doc) return <p className="px-4 py-16 text-center text-slate-400 sm:px-8">불러오는 중...</p>

  const imported = !AUTHORED.includes(doc.doc_type)
  const newer = doc.links.find((l) => l.kind === 'supersedes' && l.direction === 'in')
  const crumbLink = (to: string, label: string) => (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault()
        go(to)
      }}
      className="hover:text-blue-600"
    >
      {label}
    </a>
  )

  if (editing) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-5 sm:px-8 sm:py-6">
        <Crumbs ancestors={doc.ancestors} title={doc.title} link={crumbLink} />
        <KBEditor
          docId={doc.id}
          initialTitle={doc.title}
          initialBody={doc.body}
          parentId={doc.parent_id}
          imported={imported}
          anchor={editAnchor}
          onSaved={async (_, at) => {
            // 새 본문을 받아 온 뒤에 보기로 바꿔야 같은 자리를 찾을 수 있다
            if (mode !== 'edit') await load()
            finishEdit(at)
            if (mode === 'edit') go(`/kb/doc/${doc.id}`, { replace: true })
          }}
          onCancel={(at) => {
            finishEdit(at)
            if (mode === 'edit') go(`/kb/doc/${doc.id}`, { replace: true })
          }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-8 sm:py-6">
      <Crumbs ancestors={doc.ancestors} title={doc.title} link={crumbLink} />

      {doc.status === 'superseded' && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <b>구버전 문서</b> 검색에 나오지 않습니다.
          {newer && <> 최신: {crumbLink(`/kb/doc/${newer.other_id}`, newer.other_title)}</>}
        </div>
      )}
      {doc.status === 'proposed' && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          에이전트가 제안한 위키입니다. 승인하면 검색에 반영됩니다.
          <span className="ml-auto flex gap-2">
            <button
              onClick={() => void act(() => api.kbReviewWiki(doc.id, true), '승인했습니다.')}
              data-tip="정식 문서로 올립니다. 검색에 바로 나옵니다"
              className="rounded-lg bg-blue-600 px-3 py-1 text-sm font-semibold text-white hover:bg-blue-700 max-sm:min-h-10 max-sm:px-4"
            >
              승인
            </button>
            <button
              onClick={() => void act(() => api.kbReviewWiki(doc.id, false), '반려했습니다.')}
              data-tip="이 제안을 받지 않습니다"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50 max-sm:min-h-10 max-sm:px-4"
            >
              반려
            </button>
          </span>
        </div>
      )}

      <h1 className="text-2xl font-bold break-keep text-slate-800 [overflow-wrap:anywhere] sm:text-3xl">{doc.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
        <span>📄 {TYPE[doc.doc_type] || doc.doc_type}</span>
        <span>
          👤 {WHO[doc.created_by] || doc.created_by}
          {doc.author ? ` · ${doc.author}` : ''}
        </span>
        <span>🕒 {fmtDate(doc.updated_at)}</span>
        {imported && doc.source_path && <span title={doc.source_path}>원본 {fileName(doc.source_path)}</span>}
        {imported && doc.edited_at && (
          <span
            className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600"
            data-tip="원본 파일은 그대로입니다. 원본을 다시 가져오면 새 버전이 됩니다"
          >
            KB에서 편집됨
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {doc.tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs text-slate-700">
            #{t}
            <button
              onClick={() => void act(() => api.kbTags(doc.id, [], [t]), '태그를 뺐습니다.')}
              aria-label={`${t} 태그 삭제`}
              className="text-slate-400 hover:text-red-500 pointer-coarse:-my-1 pointer-coarse:px-1.5 pointer-coarse:text-base"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            const add = tagInput.split(',').map((s) => s.trim()).filter(Boolean)
            if (!add.length) return
            setTagInput('')
            void act(() => api.kbTags(doc.id, add, []), '태그를 추가했습니다.')
          }}
          placeholder="+ 태그"
          data-tip="태그를 적고 Enter. 쉼표로 여러 개를 한 번에 넣습니다"
          aria-label="태그 추가"
          className="w-24 rounded-full border border-dashed border-slate-300 bg-transparent px-2.5 py-0.5 text-xs focus:w-40 focus:border-blue-400 focus:outline-none max-md:py-1.5 max-md:text-base max-md:focus:w-48"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => startEdit()}
          data-tip="본문을 고칩니다. 본문을 두 번 눌러도 됩니다"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 max-sm:min-h-10"
        >
          ✏️ 편집
        </button>
        {imported && (
          <>
            <a
              href={rawUrl(doc.id)}
              target="_blank"
              rel="noreferrer"
              data-tip="올린 원본 파일을 새 탭에서 엽니다 (PDF 가 아니면 내려받습니다)"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 max-sm:min-h-10"
            >
              원본 열기
            </a>
            <a
              href={`${rawUrl(doc.id)}?download=1`}
              data-tip="원본 파일을 내려받습니다"
              className="rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-white max-sm:min-h-10"
            >
              내려받기
            </a>
          </>
        )}
        <span className="flex-1" />
        <button
          onClick={() => childFile.current?.click()}
          data-tip="PDF·Word·엑셀 같은 파일을 이 문서 아래에 올립니다"
          className="rounded-lg px-3 py-1.5 text-sm text-slate-600 transition hover:bg-white max-sm:min-h-10 max-sm:px-2"
        >
          + 파일
        </button>
        <input
          ref={childFile}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : []
            e.target.value = ''
            if (files.length) void uploadUnder(files)
          }}
        />
        <button
          onClick={() => go(`/kb/new?parent=${doc.id}`)}
          data-tip="이 문서 아래에 새 문서를 만듭니다"
          aria-label="하위 문서 추가"
          className="rounded-lg px-3 py-1.5 text-sm text-slate-600 transition hover:bg-white max-sm:min-h-10 max-sm:px-2"
        >
          + 하위<span className="max-sm:hidden"> 문서</span>
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          data-tip="문서를 삭제합니다. 하위 문서는 한 단계 위로 올라갑니다"
          aria-label="삭제"
          className="rounded-lg px-3 py-1.5 text-sm text-red-500 transition hover:bg-red-50 max-sm:min-h-10 max-sm:min-w-10 max-sm:px-2"
        >
          🗑<span className="max-sm:hidden"> 삭제</span>
        </button>
      </div>

      {(
        <>
          {doc.doc_type === 'pdf' && (
            <iframe
              title={`${doc.title} 원본`}
              src={rawUrl(doc.id)}
              className="mt-5 h-[75vh] w-full rounded-xl border border-slate-200/80 bg-white"
            />
          )}
          <article ref={article} className="mt-5 rounded-xl border border-slate-200/80 bg-white px-4 py-5 sm:px-10 sm:py-9">
            {doc.body.trim() ? (
              <KBMarkdownView text={doc.body} onDoubleClick={startEdit} />
            ) : (
              <div onDoubleClick={() => startEdit()} className="py-6 text-center text-sm text-slate-400">
                {doc.children.length ? '내용 없이 하위 문서를 묶는 문서입니다.' : '비어 있는 문서입니다.'} 두 번 누르면 쓸 수 있습니다.
              </div>
            )}
          </article>

          <section className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">
                하위 문서{' '}
                {doc.children.length > 0 && (
                  <span className="ml-1 rounded-full bg-slate-200 px-2 text-xs text-slate-600">{doc.children.length}</span>
                )}
              </h2>
              <button
                onClick={() => go(`/kb/new?parent=${doc.id}`)}
                data-tip="이 문서 아래에 새 문서를 만듭니다"
                className="text-sm text-blue-600 hover:underline max-sm:-my-2 max-sm:min-h-10 max-sm:px-2"
              >
                + 추가
              </button>
            </div>
            {doc.children.length ? (
              <ul className="divide-y divide-slate-200 rounded-xl bg-white px-4 border border-slate-200/80">
                {doc.children.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-2 text-sm max-sm:py-0.5">
                    <span aria-hidden>📄</span>
                    <a
                      href={`/kb/doc/${c.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        openInTree(doc.id)
                        go(`/kb/doc/${c.id}`)
                      }}
                      className="min-w-0 flex-1 truncate text-slate-800 hover:text-blue-600 max-sm:py-2.5"
                    >
                      {c.title}
                    </a>
                    {c.status !== 'active' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{STATUS[c.status]}</span>
                    )}
                    {(kids[c.id] || []).length > 0 && (
                      <span className="text-xs text-slate-400">하위 {(kids[c.id] || []).length}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-400">사이드바에서 다른 문서를 이 문서 위로 끌어다 놓아도 하위 문서가 됩니다.</p>
            )}
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="문서 삭제"
        message={
          `'${doc.title}' 문서를 삭제할까요? 되돌릴 수 없습니다.` +
          (doc.children.length ? `\n하위 문서 ${doc.children.length}개는 지워지지 않고 한 단계 위로 올라갑니다.` : '') +
          (imported ? '\n원본 파일은 지워지지 않습니다.' : '')
        }
        onConfirm={() => {
          setConfirmDelete(false)
          void handleDelete()
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}

function Crumbs({
  ancestors,
  title,
  link,
}: {
  ancestors: { id: string; title: string }[]
  title: string
  link: (to: string, label: string) => React.ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-400">
      {link('/kb', '지식 베이스')}
      {ancestors.map((a) => (
        <span key={a.id} className="flex items-center gap-1">
          <span>/</span>
          {link(`/kb/doc/${a.id}`, a.title)}
        </span>
      ))}
      <span>/</span>
      <span className="text-slate-600">{title}</span>
    </div>
  )
}
