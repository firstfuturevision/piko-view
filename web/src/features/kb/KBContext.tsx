import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type KBStats, type KBTreeItem } from '../../api'
import { useToast } from '../../components/ui/toastContext'
import { useConfirm } from '../../components/useConfirm'
import { Ctx, type KBState } from './useKB'

const OPEN_KEY = 'kb.open'

function loadOpen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

export function KBProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [tree, setTree] = useState<KBTreeItem[]>([])
  const [stats, setStats] = useState<KBStats | null>(null)
  const [open, setOpen] = useState<Set<string>>(loadOpen)
  const dirtyRef = useRef(false)
  const [ask, confirmEl] = useConfirm()

  const byId = useMemo(() => Object.fromEntries(tree.map((d) => [d.id, d])), [tree])
  const byTitle = useMemo(() => {
    const out: Record<string, KBTreeItem> = {}
    for (const d of tree) if (!out[d.title] || d.status === 'active') out[d.title] = d
    return out
  }, [tree])
  const kids = useMemo(() => {
    const visible = (d?: KBTreeItem) => !!d && d.status !== 'superseded'
    const out: Record<string, KBTreeItem[]> = {}
    for (const d of tree) {
      if (!visible(d)) continue
      const key = d.parent_id && visible(byId[d.parent_id]) ? d.parent_id : ''
      ;(out[key] ??= []).push(d)
    }
    return out
  }, [tree, byId])

  const toast = useToast()

  const loadTree = useCallback(async () => {
    try {
      setTree(await api.kbTree())
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) navigate('/login', { replace: true })
      else toast(e instanceof Error ? e.message : '문서 목록을 불러오지 못했습니다.')
    }
  }, [navigate, toast])

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.kbStatus())
    } catch {
      /* 상태 표시는 부가 정보 */
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 응답(await) 뒤에만 상태를 바꾼다
    void loadTree()
    void loadStats()
  }, [loadTree, loadStats])

  // 임베딩 모델을 받는 동안에는 상태를 주기적으로 갱신한다
  useEffect(() => {
    if (stats?.embedder_state !== 'loading' && stats?.embedder_state !== 'idle') return
    const t = window.setInterval(() => void loadStats(), 5000)
    return () => window.clearInterval(t)
  }, [stats?.embedder_state, loadStats])

  const persistOpen = (s: Set<string>) => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...s]))
    } catch {
      /* 저장 못 해도 동작에는 문제없다 */
    }
    return s
  }
  const toggleOpen = useCallback((id: string) => {
    setOpen((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return persistOpen(s)
    })
  }, [])
  const openInTree = useCallback((id: string) => {
    setOpen((prev) => (prev.has(id) ? prev : persistOpen(new Set(prev).add(id))))
  }, [])

  const ancestorIds = useCallback(
    (id: string) => {
      const out: string[] = []
      let p = byId[id]?.parent_id
      while (p && byId[p] && !out.includes(p)) {
        out.unshift(p)
        p = byId[p].parent_id
      }
      return out
    },
    [byId],
  )
  const pathText = useCallback(
    (id: string) => ancestorIds(id).map((a) => byId[a].title).join(' › '),
    [ancestorIds, byId],
  )
  const isInside = useCallback(
    (id: string, maybeAncestor: string) => ancestorIds(id).includes(maybeAncestor),
    [ancestorIds],
  )

  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d
  }, [])
  const go = useCallback(
    async (path: string, opts?: { replace?: boolean }) => {
      if (
        dirtyRef.current &&
        !(await ask({ title: '저장하지 않은 내용', message: '저장하지 않은 내용이 있습니다. 이 페이지를 떠날까요?', confirmLabel: '떠나기' }))
      )
        return
      dirtyRef.current = false
      navigate(path, opts)
    },
    [navigate, ask],
  )

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    // 받는 곳이 아닌 데에 파일을 떨어뜨려도 브라우저가 그 파일로 이동하지 않게 한다
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types || [])].includes('Files')
    const stop = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  const value: KBState = {
    tree, byId, byTitle, kids, stats, loadTree, loadStats, ancestorIds, pathText, isInside,
    open, toggleOpen, openInTree, toast, setDirty, go,
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      {confirmEl}
    </Ctx.Provider>
  )
}
