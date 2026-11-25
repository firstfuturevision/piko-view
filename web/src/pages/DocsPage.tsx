import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type DocSummary } from '../api'
import { useLabel } from '../view/template'
import DocCard from '../features/docs/DocCard'
import { errorText } from '../features/docs/docUtils'
import NewDocDialog from '../features/docs/NewDocDialog'
import { canDeleteDoc, DOC_DELETE_WARNING, useDocFileMenu } from '../features/docs/useDocFileMenu'
import { BulkBar, BulkDeleteDialog } from '../components/ui/bulkSelect'
import { bulkResultText, useBulkSelect } from '../components/ui/useBulkSelect'
import { useMarqueeSelect } from '../components/ui/useMarqueeSelect'
import { useToast } from '../components/ui/toastContext'
import ErrorBanner from '../components/ui/ErrorBanner'

type Tab = 'all' | 'mine'

const TABS: { key: Tab; label: string; tip: string }[] = [
  { key: 'all', label: '전체', tip: '내가 볼 수 있는 문서를 모두 최근 고친 순으로 봅니다' },
  { key: 'mine', label: '내 파일', tip: '내가 만든 개인 파일과 다른 사람이 나에게 공유한 파일' },
]

const segBtn = (on: boolean) =>
  `rounded-md px-3 py-1 text-[13px] font-medium transition ${
    on ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-800'
  }`

/** 문서: 여럿이 함께 쓰는 문서를 만들고 찾는 곳 (편집은 /docs/:id) */
export default function DocsPage() {
  const [params, setParams] = useSearchParams()
  const label = useLabel()
  const tab = (params.get('tab') === 'mine' ? 'mine' : 'all') as Tab
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [version, setVersion] = useState(0)

  const [deleting, setDeleting] = useState<DocSummary[] | null>(null)
  const toast = useToast()
  // 한꺼번에 지우다 안 된 것 (목록을 다시 불러와도 남게 따로 둔다)
  const [bulkError, setBulkError] = useState('')

  const menu = useDocFileMenu(() => setVersion((v) => v + 1), setError)

  useEffect(() => {
    let alive = true
    api
      .listDocs()
      .then((d) => alive && setDocs(d))
      .catch((e) => alive && setError(errorText(e, '문서를 불러오지 못했습니다.')))
    return () => {
      alive = false
    }
  }, [version])

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const filtered = useMemo(() => {
    const word = q.trim().toLowerCase()
    return (docs ?? [])
      // 슬라이드는 이 화면에서 다루지 않는다
      .filter((d) => d.kind === 'doc')
      .filter((d) => (tab === 'mine' ? d.project === null : true))
      .filter(
        (d) =>
          !word ||
          d.title.toLowerCase().includes(word) ||
          (d.project_name ?? '').toLowerCase().includes(word) ||
          d.owner_name.toLowerCase().includes(word),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [docs, tab, q])

  const visible = filtered
  const bulk = useBulkSelect(visible, canDeleteDoc)
  const marquee = useMarqueeSelect(bulk)
  const locked = visible.length - bulk.choosableCount

  const grid = (list: DocSummary[], showLocation: boolean) => (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {list.map((d) => (
        <DocCard key={d.id} doc={d} menu={menu} showLocation={showLocation} bulk={bulk} />
      ))}
    </ul>
  )

  const empty = (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-16 text-center text-sm text-slate-400">
      {q
        ? '찾는 파일이 없습니다.'
        : tab === 'mine'
          ? "내 파일이 없습니다. '+ 새 문서'로 나만 보는 문서를 만들어 보세요."
          : "아직 문서가 없습니다. '+ 새 문서'로 시작하세요."}
    </div>
  )

  return (
    // 빈 자리를 끌어 여러 개 고르기 (PC 마우스) — 화면 어디 빈 곳에서나 시작한다
    <main className="px-6 py-8" onPointerDown={marquee.onPointerDown}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[22px] font-bold tracking-tight whitespace-nowrap text-slate-900">{label('docs', '문서')}</h2>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setCreating(true)}
            data-tip="여럿이 함께 쓰는 문서를 만듭니다. 회의록·기획서 같은 템플릿을 고를 수 있습니다"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + 새 문서
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="보기" className="flex gap-0.5 rounded-lg bg-slate-200/60 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              data-tip={t.tip}
              onClick={() => setParam('tab', t.key === 'all' ? null : t.key)}
              className={segBtn(tab === t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·만든 사람 검색"
          aria-label="문서 검색"
          className="ml-auto w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        />
        {!bulk.selecting && visible.length > 0 && <BulkBar bulk={bulk} onDelete={() => {}} />}
      </div>

      <ErrorBanner className="mb-4" onClose={() => setBulkError('')}>
        {bulkError}
      </ErrorBanner>
      {bulk.selecting && (
        <BulkBar
          bulk={bulk}
          onDelete={() => setDeleting(bulk.selected)}
          note={locked > 0 ? `공유받은 파일 ${locked}개는 만든 사람만 지울 수 있어 고를 수 없습니다` : undefined}
        />
      )}

      {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      {/* 목록 아래 빈 곳에서도 끌어 고르기를 시작하게 높이를 둔다 */}
      <div className="min-h-[60vh] pb-10">
        {docs === null ? (
          <p className="py-10 text-center text-slate-400">불러오는 중...</p>
        ) : filtered.length === 0 ? (
          empty
        ) : (
          grid(filtered, true)
        )}
      </div>
      {marquee.overlay}

      {menu.element}
      <BulkDeleteDialog
        items={deleting}
        what="파일"
        name={(d) => d.title}
        warning={DOC_DELETE_WARNING}
        remove={(d) => api.deleteDoc(d.id)}
        onClose={() => setDeleting(null)}
        onDone={(r) => {
          bulk.clear()
          setVersion((v) => v + 1)
          if (r.failed.length) setBulkError(bulkResultText('파일', r))
          else toast(bulkResultText('파일', r))
          if (!r.failed.length) setBulkError('')
        }}
      />
      <NewDocDialog open={creating} kind="doc" onClose={() => setCreating(false)} />
    </main>
  )
}
