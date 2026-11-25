import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type KBSearchHit } from '../../api'
import { useKB } from './useKB'

export default function KBSearchPage() {
  const { go } = useKB()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const [query, setQuery] = useState(q)
  const [mode, setMode] = useState('hybrid')
  // 주소의 검색어가 바뀌면 입력칸도 (렌더 중에 맞춘다)
  const [seenQ, setSeenQ] = useState(q)
  if (seenQ !== q) {
    setSeenQ(q)
    setQuery(q)
  }
  // 결과는 어떤 검색(q·mode)의 것인지와 함께 둔다: 지금 검색과 다르면 불러오는 중
  const key = `${mode}\u0000${q}`
  const [result, setResult] = useState<{ key: string; hits: KBSearchHit[] } | null>(null)
  const hits = q && result?.key === key ? result.hits : null
  const loading = !!q && result?.key !== key

  useEffect(() => {
    if (!q) return
    let alive = true
    api
      .kbSearch(q, mode, 12)
      .then((h) => alive && setResult({ key, hits: h }))
      .catch(() => alive && setResult({ key, hits: [] }))
    return () => {
      alive = false
    }
  }, [q, mode, key])

  function submit(e: FormEvent) {
    e.preventDefault()
    const v = query.trim()
    if (v) setParams({ q: v }, { replace: true })
  }

  // 문서별로 조각을 묶는다
  const groups = new Map<string, KBSearchHit[]>()
  for (const h of hits || []) {
    if (!groups.has(h.doc_id)) groups.set(h.doc_id, [])
    groups.get(h.doc_id)!.push(h)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-[22px] font-bold tracking-tight text-slate-900">검색</h1>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="질문이나 키워드 (예: 반품하면 돈 돌려받을 수 있나요?)"
          aria-label="검색어"
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none max-md:h-10 max-md:text-base"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          aria-label="검색 방식"
          data-tip="키워드는 같은 낱말, 의미는 뜻이 비슷한 글을 찾습니다. 하이브리드는 둘 다"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 text-sm max-md:h-10"
        >
          <option value="hybrid">하이브리드</option>
          <option value="keyword">키워드</option>
          <option value="vector">의미</option>
        </select>
        <button className="shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700 max-md:h-10 max-sm:px-3">검색</button>
      </form>

      <div className="mt-5">
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">검색하는 중…</p>
        ) : hits === null ? null : groups.size === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">결과가 없습니다. 다른 표현으로 검색해 보세요.</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-400">{groups.size}개 문서</p>
            <div className="space-y-3">
              {[...groups.values()].map((rs) => (
                <a
                  key={rs[0].doc_id}
                  href={`/kb/doc/${rs[0].doc_id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    go(`/kb/doc/${rs[0].doc_id}`)
                  }}
                  className="block rounded-xl bg-white p-4 border border-slate-200/80 transition hover:border-slate-300"
                >
                  {rs[0].path && <div className="text-xs text-slate-400">{rs[0].path}</div>}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold break-keep text-slate-800 [overflow-wrap:anywhere]">
                    {rs[0].title}
                    <span
                      data-tip="이 문서가 어떤 방식으로 찾아졌는지입니다"
                      className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-normal text-blue-600"
                    >
                      {[...new Set(rs.flatMap((r) => r.via))].map((v) => (v === 'keyword' ? '키워드' : '의미')).join(' + ')}
                    </span>
                  </div>
                  {rs.map((r) => (
                    <p key={r.chunk_ord} className="mt-1.5 text-sm break-words whitespace-pre-line text-slate-600">
                      {r.heading && <b className="mr-1 text-slate-700">{r.heading}</b>}
                      {r.text.length > 240 ? `${r.text.slice(0, 240)}…` : r.text}
                    </p>
                  ))}
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
