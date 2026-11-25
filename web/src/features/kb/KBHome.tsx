import { useCallback, useEffect, useState } from 'react'
import { api, type KBPendingWiki, type KBTreeItem } from '../../api'
import { useKB } from './useKB'
import { fmtShort, STATUS, WHO } from './kbLabels'

export function DocRow({ d }: { d: KBTreeItem }) {
  const { go, pathText } = useKB()
  const path = pathText(d.id)
  return (
    <li className="flex items-center gap-2 py-2 text-sm max-sm:py-0.5">
      <span aria-hidden>📄</span>
      <a
        href={`/kb/doc/${d.id}`}
        onClick={(e) => {
          e.preventDefault()
          go(`/kb/doc/${d.id}`)
        }}
        className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:text-blue-600 max-sm:py-2.5"
      >
        {d.title}
      </a>
      {d.status !== 'active' && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{STATUS[d.status]}</span>
      )}
      {path && <span className="hidden truncate rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 sm:inline">{path}</span>}
      <span className="shrink-0 text-xs text-slate-400">{fmtShort(d.updated_at)}</span>
    </li>
  )
}

export default function KBHome() {
  const { tree, kids, byId, go, toast, loadTree } = useKB()
  const [pending, setPending] = useState<KBPendingWiki[]>([])
  const active = tree.filter((d) => d.status === 'active')
  const roots = kids[''] || []
  const recent = [...active].sort((a, b) => b.updated_at - a.updated_at).slice(0, 8)
  const pendingCount = tree.filter((d) => d.status === 'proposed').length

  const loadPending = useCallback(async () => {
    try {
      setPending(await api.kbPendingWiki())
    } catch {
      setPending([])
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 응답(await) 뒤에만 상태를 바꾼다
    void loadPending()
  }, [loadPending, pendingCount])

  async function review(id: string, approve: boolean) {
    try {
      await api.kbReviewWiki(id, approve)
      toast(approve ? '승인했습니다. 이제 검색에 반영됩니다.' : '반려했습니다.')
      await loadTree()
    } catch (e) {
      toast(e instanceof Error ? e.message : '처리하지 못했습니다.')
    }
  }

  // 위키 미리보기: [[제목]] 과 [문서ID] 를 제목 글자로만 보여 준다
  const snippet = (text: string) =>
    text
      .replace(/\[\[([^\]\n]+)\]\]/g, '$1')
      .replace(/\[((?:d|w|n)_[0-9a-f]{10})\]/g, (_, id: string) => byId[id]?.title || id)
      .slice(0, 200)

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="flex items-center gap-2">
        <h1 className="text-[22px] font-bold tracking-tight text-slate-900">지식 베이스</h1>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        문서 {active.length}건{pendingCount ? ` · 승인 대기 ${pendingCount}건` : ''} · 사람은 여기서 문서를 쓰고 정리하고,
        외부 에이전트는 API로 붙어서 찾고 정리합니다.
      </p>

      {pending.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold tracking-wider text-slate-400">승인 대기</h2>
          <div className="space-y-3">
            {pending.map((w) => (
              <div key={w.id} className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`/kb/doc/${w.id}`}
                    onClick={(e) => {
                      e.preventDefault()
                      go(`/kb/doc/${w.id}`)
                    }}
                    className="font-semibold text-slate-800 hover:text-blue-600"
                  >
                    📘 {w.title}
                  </a>
                  <span className="text-xs text-slate-400">
                    {WHO[w.created_by] || w.created_by}
                    {w.author ? `(${w.author})` : ''} 제안 · {fmtShort(w.created_at)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{snippet(w.text)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => void review(w.id, true)}
                    data-tip="이 문서를 정식 문서로 올립니다. 검색에 바로 나옵니다"
                    className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    승인
                  </button>
                  <button
                    onClick={() => void review(w.id, false)}
                    data-tip="이 제안을 받지 않습니다"
                    className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
                  >
                    반려
                  </button>
                  <button
                    onClick={() => go(`/kb/doc/${w.id}/edit`)}
                    data-tip="편집 화면을 열어 내용을 고칩니다"
                    className="rounded-lg px-3.5 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100"
                  >
                    ✏️ 고친 뒤 승인
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-bold tracking-wider text-slate-400">DOCS</h2>
        {roots.length ? (
          <div className="grid gap-3 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
            {roots.map((d) => {
              const ch = kids[d.id] || []
              return (
                <a
                  key={d.id}
                  href={`/kb/doc/${d.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    go(`/kb/doc/${d.id}`)
                  }}
                  className="rounded-xl bg-white p-4 border border-slate-200/80 transition hover:-translate-y-0.5 hover:border-slate-300"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden>📁</span>
                    <b className="min-w-0 flex-1 truncate text-slate-800">{d.title}</b>
                    {ch.length > 0 && (
                      <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">{ch.length}</span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-sm text-slate-500">
                    {ch.length ? (
                      <>
                        {ch.slice(0, 4).map((c) => (
                          <li key={c.id} className="truncate">· {c.title}</li>
                        ))}
                        {ch.length > 4 && <li className="text-xs text-slate-400">외 {ch.length - 4}개</li>}
                      </>
                    ) : (
                      <li className="text-slate-400">하위 문서 없음</li>
                    )}
                  </ul>
                </a>
              )
            })}
          </div>
        ) : (
          <p className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
            아직 문서가 없습니다. 문서 목록의 ＋로 만들거나 파일을 사이드바로 끌어다 놓으세요.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-bold tracking-wider text-slate-400">최근 수정</h2>
        {recent.length ? (
          <ul className="divide-y divide-slate-200 rounded-xl bg-white px-4 border border-slate-200/80">
            {recent.map((d) => (
              <DocRow key={d.id} d={d} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">없음</p>
        )}
      </section>
    </div>
  )
}
