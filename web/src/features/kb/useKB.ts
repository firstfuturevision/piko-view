import { createContext, useContext } from 'react'
import type { KBStats, KBTreeItem } from '../../api'

export interface KBState {
  tree: KBTreeItem[]
  byId: Record<string, KBTreeItem>
  /** 제목 → 문서 (같은 제목이면 활성 문서 우선). [[제목]] 연결에 쓴다 */
  byTitle: Record<string, KBTreeItem>
  /** 상위 문서 id('' = 최상위) → 보이는 하위 문서 (구버전 제외, 상위가 안 보이면 최상위로) */
  kids: Record<string, KBTreeItem[]>
  stats: KBStats | null
  loadTree: () => Promise<void>
  loadStats: () => Promise<void>
  ancestorIds: (id: string) => string[]
  pathText: (id: string) => string
  isInside: (id: string, maybeAncestor: string) => boolean
  open: Set<string>
  toggleOpen: (id: string) => void
  openInTree: (id: string) => void
  toast: (msg: string) => void
  /** 편집 중인 내용이 있는지 (KB 안에서 이동할 때 확인한다) */
  setDirty: (dirty: boolean) => void
  /** KB 안 이동. 저장하지 않은 편집이 있으면 먼저 묻는다 */
  go: (path: string, opts?: { replace?: boolean }) => void
}

export const Ctx = createContext<KBState | null>(null)

export function useKB(): KBState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useKB must be used within KBProvider')
  return ctx
}
