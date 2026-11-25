import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import Icon from '../../components/Icon'
import { useKB } from './useKB'

/** 좁은 화면(lg 미만)의 위쪽 막대: 문서 목록(서랍) 열기 · 검색 · 새 문서. 넓은 화면에서는 사이드바가 같은 일을 한다. */
export default function KBMobileBar({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const { go, tree } = useKB()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const pending = tree.filter((d) => d.status === 'proposed').length
  // 검색 화면에는 자체 검색창이 있으므로 여기서는 숨긴다
  const onSearchPage = location.pathname.startsWith('/kb/search')

  function submit(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q) go(`/kb/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="문서 목록 열기"
        className="relative flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        <Icon name="sidebar" className="h-4 w-4" />
        문서 목록
        {pending > 0 && (
          <span className="absolute -top-1.5 -right-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">
            {pending}
          </span>
        )}
      </button>
      {onSearchPage ? (
        <span className="flex-1" />
      ) : (
        <form onSubmit={submit} className="min-w-0 flex-1" role="search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="문서 검색"
            aria-label="문서 검색"
            enterKeyHint="search"
            className="h-10 w-full min-w-0 rounded-lg border border-slate-300 px-3 text-base focus:border-blue-500 focus:outline-none md:text-sm"
          />
        </form>
      )}
      <button
        type="button"
        onClick={() => go('/kb/new')}
        aria-label="새 문서"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xl leading-none text-white transition hover:bg-blue-700"
      >
        +
      </button>
    </div>
  )
}
