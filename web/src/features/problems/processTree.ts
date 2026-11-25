import type { ProcessNode } from '../../api'

/** 평평한 단계 목록으로 지은 나무: id → 단계, 윗단계 id(맨 위는 null) → 하위 단계(순서대로) */
export interface ProcessTree {
  byId: Map<number, ProcessNode>
  children: Map<number | null, ProcessNode[]>
  /** 맨 위 단계 중 회사 일의 흐름에 드는 것 */
  flow: ProcessNode[]
  /** 맨 위 단계 중 흐름 밖 지원 단계 (회사 운영 등) */
  support: ProcessNode[]
}

export function buildTree(nodes: ProcessNode[]): ProcessTree {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<number | null, ProcessNode[]>()
  for (const n of nodes) {
    // 윗단계가 목록에 없으면 (지워지는 중 등) 맨 위로 본다
    const key = n.parent !== null && byId.has(n.parent) ? n.parent : null
    const list = children.get(key) ?? []
    list.push(n)
    children.set(key, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.id - b.id)
  const top = children.get(null) ?? []
  return {
    byId,
    children,
    flow: top.filter((n) => !n.is_support),
    support: top.filter((n) => n.is_support),
  }
}

export function childrenOf(tree: ProcessTree, id: number | null): ProcessNode[] {
  return tree.children.get(id) ?? []
}

/** 나무 순서(윗단계 바로 밑에 하위 단계)로 펼친 목록. 흐름 단계 먼저, 지원 단계는 뒤에 */
export function flatten(tree: ProcessTree): ProcessNode[] {
  const out: ProcessNode[] = []
  const walk = (n: ProcessNode) => {
    out.push(n)
    childrenOf(tree, n.id).forEach(walk)
  }
  ;[...tree.flow, ...tree.support].forEach(walk)
  return out
}

/** 선택 칸(<option>)용: 깊이만큼 들여 쓴 이름 */
export function indentedLabel(n: ProcessNode, depth = n.depth): string {
  return depth === 0 ? n.title : `${'\u00a0\u00a0\u00a0'.repeat(depth - 1)}\u00a0└ ${n.title}`
}
