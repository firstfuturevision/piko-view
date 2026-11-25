import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import Icon from '../../components/Icon'
import { useLocation } from 'react-router-dom'
import { api, type KBTreeItem } from '../../api'
import { openInNewTab, type MenuEntry } from '../../components/ui/menuEntries'
import { useContextMenu, useCopyLink } from '../../components/ui/useContextMenu'
import { useKB } from './useKB'

type Zone = 'inside' | 'before' | 'after'
const TIP_KEY = 'kb.dndTipSeen'

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types || [])].includes('Files')

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

interface Props {
  /** 좁은 화면(lg 미만)에서 서랍으로 열려 있는지 */
  drawerOpen?: boolean
  onClose?: () => void
}

export default function KBSidebar({ drawerOpen = false, onClose }: Props) {
  const kb = useKB()
  const { kids, byId, tree, open, toggleOpen, openInTree, isInside, go, toast, loadTree } = kb
  const location = useLocation()
  const currentDoc = location.pathname.match(/^\/kb\/doc\/([^/]+)/)?.[1] ?? null
  const [query, setQuery] = useState('')
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null)
  const [rootOver, setRootOver] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const [tipSeen, setTipSeen] = useState(() => readFlag(TIP_KEY))
  const dragId = useRef<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const pending = tree.filter((d) => d.status === 'proposed').length
  const copyLink = useCopyLink()
  // 문서 줄 우클릭 메뉴: 열기·새 탭·링크 복사·하위 문서 만들기·펼치기/접기
  const rowMenu = useContextMenu(
    (d: KBTreeItem): MenuEntry[] => {
      const path = `/kb/doc/${d.id}`
      const hasKids = (kids[d.id] || []).length > 0
      return [
        { label: '열기', icon: '↗', onSelect: () => go(path) },
        { label: '새 탭에서 열기', icon: '⧉', onSelect: () => openInNewTab(path) },
        { label: '링크 복사', icon: '🔗', onSelect: () => copyLink(path) },
        'divider',
        { label: '하위 문서 만들기', icon: '+', tip: '이 문서 아래에 새 하위 문서를 만듭니다', onSelect: () => go(`/kb/new?parent=${d.id}`) },
        hasKids && { label: open.has(d.id) ? '접기' : '펼치기', icon: '▸', onSelect: () => toggleOpen(d.id) },
      ]
    },
    { label: '문서 메뉴', width: 180 },
  )

  // Ctrl+K: 검색창으로
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 문서를 열면 상위 문서를 펼쳐 사이드바에서 보이게 한다
  useEffect(() => {
    if (currentDoc) kb.ancestorIds(currentDoc).forEach(openInTree)
  }, [currentDoc, kb, openInTree])

  function markTipSeen() {
    setTipSeen(true)
    try {
      localStorage.setItem(TIP_KEY, '1')
    } catch {
      /* 무시 */
    }
  }

  function clearDnD() {
    setDrop(null)
    setRootOver(false)
    setFileOver(false)
  }

  async function moveDoc(id: string, parentId: string | null, index: number | null) {
    try {
      await api.kbMove(id, parentId, index)
      markTipSeen()
      if (parentId) openInTree(parentId)
      toast(parentId ? `'${byId[id].title}' → '${byId[parentId].title}' 아래` : `'${byId[id].title}' → 최상위`)
      await loadTree()
    } catch (e) {
      toast(e instanceof Error ? e.message : '옮기지 못했습니다.')
    }
  }

  async function importFiles(files: FileList, parentId: string | null) {
    const list = [...files]
    toast(`${list.length}개 파일을 가져오는 중…`)
    try {
      const res = await api.kbUpload(list, parentId)
      if (parentId) openInTree(parentId)
      markTipSeen()
      await loadTree()
      void kb.loadStats()
      const ok = res.filter((r) => r.status === 'added' || r.status === 'updated').length
      const err = res.find((r) => r.status === 'error')
      toast(err && !ok ? err.error! : `${ok}개 가져옴${res.length > ok ? ` · ${res.length - ok}개는 이미 있거나 오류` : ''}`)
      const first = res.find((r) => r.doc_id && (r.status === 'added' || r.status === 'updated'))
      if (list.length === 1 && first?.doc_id) go(`/kb/doc/${first.doc_id}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '가져오지 못했습니다.')
    }
  }

  function zoneOf(e: DragEvent, row: HTMLElement): Zone {
    if (hasFiles(e)) return 'inside'
    const r = row.getBoundingClientRect()
    const y = e.clientY - r.top
    return y < r.height * 0.28 ? 'before' : y > r.height * 0.72 ? 'after' : 'inside'
  }

  function onRowDrop(e: DragEvent<HTMLDivElement>, d: KBTreeItem) {
    e.preventDefault()
    e.stopPropagation()
    const zone = zoneOf(e, e.currentTarget)
    const moving = dragId.current
    clearDnD()
    if (hasFiles(e) && e.dataTransfer.files.length) return void importFiles(e.dataTransfer.files, d.id)
    if (!moving || moving === d.id || isInside(d.id, moving)) return
    if (zone === 'inside') return void moveDoc(moving, d.id, null)
    const parent = d.parent_id && byId[d.parent_id] ? d.parent_id : null
    const sibs = (kids[parent || ''] || []).filter((x) => x.id !== moving)
    const idx = sibs.findIndex((x) => x.id === d.id)
    void moveDoc(moving, parent, zone === 'before' ? idx : idx + 1)
  }

  // 컴포넌트가 아닌 렌더 함수로 둔다 — 끄는 도중 다시 그려져도 DOM 이 바뀌지 않아야 끌기가 끊기지 않는다
  const renderRow = (d: KBTreeItem, depth: number) => {
    const ch = kids[d.id] || []
    const isOpen = open.has(d.id)
    const z = drop?.id === d.id ? drop.zone : null
    return (
      <div key={d.id} role="treeitem" aria-expanded={ch.length ? isOpen : undefined}>
        <div
          draggable
          onDragStart={(e) => {
            dragId.current = d.id
            e.dataTransfer.setData('text/plain', d.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            dragId.current = null
            clearDnD()
          }}
          onDragOver={(e) => {
            const files = hasFiles(e)
            const moving = dragId.current
            // 자기 자신·자기 하위 문서에는 놓을 수 없다
            if (!files && (!moving || moving === d.id || isInside(d.id, moving))) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = files ? 'copy' : 'move'
            const zone = zoneOf(e, e.currentTarget)
            if (drop?.id !== d.id || drop.zone !== zone) setDrop({ id: d.id, zone })
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null)
          }}
          onDrop={(e) => onRowDrop(e, d)}
          onContextMenu={rowMenu.onContextMenu(d, { links: false })}
          className={`group relative flex items-center gap-0.5 rounded-lg pr-1 text-sm transition ${
            d.id === currentDoc ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-600 hover:bg-slate-50'
          } ${z === 'inside' ? 'ring-2 ring-blue-400 ring-inset' : ''}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          title={d.title}
        >
          {z === 'before' && <span className="absolute inset-x-1 top-0 h-0.5 rounded bg-blue-500" />}
          {z === 'after' && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-blue-500" />}
          <button
            type="button"
            onClick={() => toggleOpen(d.id)}
            aria-label={isOpen ? '접기' : '펼치기'}
            tabIndex={ch.length ? 0 : -1}
            className={`flex h-6 w-5 shrink-0 items-center justify-center text-[10px] text-slate-400 transition max-lg:h-10 max-lg:w-8 ${
              ch.length ? 'hover:text-slate-700' : 'invisible'
            } ${isOpen ? 'rotate-90' : ''}`}
          >
            ▶
          </button>
          <a
            href={`/kb/doc/${d.id}`}
            draggable={false}
            onClick={(e) => {
              e.preventDefault()
              go(`/kb/doc/${d.id}`)
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 max-lg:py-2.5"
          >
            <span className="shrink-0 text-xs" aria-hidden>
              {d.doc_type === 'wiki' ? '📘' : '📄'}
            </span>
            <span className="truncate">{d.title}</span>
            {d.status === 'proposed' && (
              <span
                data-tip="제안된 문서입니다. 승인해야 검색에 나옵니다"
                className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700">
                승인 대기
              </span>
            )}
          </a>
          <button
            type="button"
            onClick={() => go(`/kb/new?parent=${d.id}`)}
            data-tip="이 문서 아래에 새 하위 문서를 만듭니다"
            aria-label={`${d.title} 아래에 하위 문서 추가`}
            className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 transition group-hover:flex pointer-coarse:flex hover:bg-slate-200 hover:text-slate-700 max-lg:flex max-lg:h-9 max-lg:w-9 max-lg:text-base"
          >
            +
          </button>
        </div>
        {ch.length > 0 && isOpen && <div role="group">{ch.map((c) => renderRow(c, depth + 1))}</div>}
      </div>
    )
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q) go(`/kb/search?q=${encodeURIComponent(q)}`)
  }

  const path = location.pathname
  const menu = [
    {
      to: '/kb',
      label: '홈',
      icon: 'home' as const,
      active: path === '/kb' || path === '/kb/',
      badge: pending,
      tip: '최상위 문서, 최근 수정, 승인 대기 문서를 봅니다',
    },
  ]
  const roots = kids[''] || []
  const st = kb.stats

  return (
    <aside
      aria-label="지식 베이스 문서 목록"
      className={`fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-80 shrink-0 flex-col border-r border-slate-200 bg-white shadow-2xl transition-[translate,visibility] duration-200 lg:static lg:z-auto lg:w-72 lg:max-w-none lg:translate-x-0 lg:shadow-none lg:visible ${
        drawerOpen ? 'translate-x-0' : 'invisible -translate-x-full'
      } ${fileOver ? 'bg-blue-50/60' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault() // 문서 줄이 아닌 빈 곳에 놓아도 최상위로 가져온다
        if (!fileOver) setFileOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) clearDnD()
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        clearDnD()
        if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files, null)
      }}
    >
      {/* 서랍일 때만: 제목과 닫기 */}
      <div className="flex items-center justify-between border-b border-slate-100 py-1.5 pr-2 pl-4 lg:hidden">
        <span className="text-sm font-bold text-slate-800">지식 베이스</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="문서 목록 닫기"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
        >
          ✕
        </button>
      </div>
      <div className="border-b border-slate-100 p-3">
        <form onSubmit={submitSearch}>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="문서 검색 (Ctrl+K)"
            data-tip="낱말이나 질문을 넣고 Enter 를 누르세요"
            aria-label="문서 검색"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none max-md:py-2.5 max-md:text-base"
          />
        </form>
        <ul className="mt-2 space-y-0.5">
          {menu.map((m) => (
            <li key={m.to}>
              <a
                href={m.to}
                onClick={(e) => {
                  e.preventDefault()
                  go(m.to)
                }}
                data-tip={m.tip}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition max-lg:py-2.5 ${
                  m.active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon name={m.icon} className="h-4 w-4" />
                <span className="flex-1">{m.label}</span>
                {!!m.badge && (
                  <span
                    className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-700"
                    data-tip={`승인 대기 ${m.badge}건. 홈에서 승인하거나 반려합니다`}
                  >
                    {m.badge}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-xs font-bold tracking-wider text-slate-400">DOCS</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            data-tip="PDF·Word·엑셀·CSV·텍스트 파일을 최상위 문서로 올립니다. 글은 검색되고 [[ ]] 로 다른 문서와 이어지며, PDF 는 문서 화면에서 원본을 봅니다. 문서 위에 끌어다 놓으면 그 아래로 들어갑니다"
            className="rounded px-1.5 py-0.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 max-lg:py-2"
          >
            파일 올리기
          </button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void importFiles(e.target.files, null)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => go('/kb/new')}
            data-tip="최상위에 새 문서를 만듭니다"
            aria-label="새 문서"
            className="rounded px-1.5 text-lg leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 max-lg:flex max-lg:h-9 max-lg:w-9 max-lg:items-center max-lg:justify-center"
          >
            +
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 scroll-pane px-2 pb-2" role="tree" aria-label="문서 트리">
        {!tipSeen && tree.length > 0 && (
          <p className="mx-1 mb-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-500 pointer-coarse:hidden">
            문서를 끌어다 다른 문서 위에 놓으면 하위 문서가 됩니다. 컴퓨터의 파일을 놓으면 문서로 가져옵니다.
          </p>
        )}
        {roots.length ? (
          roots.map((d) => renderRow(d, 0))
        ) : (
          <p className="px-2.5 py-2 text-xs text-slate-400">
            문서가 없습니다. ＋로 만들거나 파일을 여기로 끌어다 놓으세요.
          </p>
        )}
        {/* 맨 아래 칸: 문서를 끌 때는 "최상위로 옮기기", 파일을 끌 때는 "최상위로 가져오기" */}
        <div
          onDragOver={(e) => {
            if (!dragId.current && !hasFiles(e)) return
            e.preventDefault()
            e.stopPropagation()
            setDrop(null)
            setRootOver(true)
          }}
          onDragLeave={() => setRootOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const moving = dragId.current
            const files = e.dataTransfer.files
            clearDnD()
            if (moving) void moveDoc(moving, null, null)
            else if (files.length) void importFiles(files, null)
          }}
          data-tip="문서나 파일을 여기에 놓으면 맨 위 단계로 갑니다"
          className={`mt-2 rounded-lg border border-dashed px-3 py-2 text-center text-xs transition pointer-coarse:hidden ${
            rootOver ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-400'
          }`}
        >
          {fileOver ? '최상위로 가져오기' : '최상위로 옮기기'}
        </div>
      </div>

      <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
        문서 {st?.documents.active ?? 0}건
        {st && (
          <span
            className="block truncate"
            data-tip="의미 검색이 켜져 있으면 낱말이 달라도 뜻이 비슷한 문서를 찾습니다"
          >
            {st.embedder === 'none'
              ? '의미 검색 꺼짐 (키워드 검색)'
              : st.embedder_state === 'ready'
                ? `의미 검색 준비됨 · ${st.embedder.split('/').pop()}`
                : st.embedder_state === 'error'
                  ? '임베딩 모델 오류 · 키워드 검색만 사용'
                  : `임베딩 모델 준비 중… (${st.embedded_chunks}/${st.chunks}) · 키워드 검색 동작`}
          </span>
        )}
        {st?.embedder_state === 'error' && (
          <div className="mt-1 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-rose-500" data-tip={`이유: ${st.embedder_error || '알 수 없음'}`}>
              {st.embedder_error || '이유를 알 수 없음'}
            </span>
            <button
              type="button"
              onClick={() => void api.kbEmbedRetry().then(() => kb.loadStats())}
              data-tip="임베딩 모델을 다시 불러옵니다. 처음이면 모델을 내려받느라 몇 분 걸릴 수 있습니다"
              className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              다시 시도
            </button>
          </div>
        )}
      </div>
      {rowMenu.element}
    </aside>
  )
}
