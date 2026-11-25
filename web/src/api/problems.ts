import { request } from './client'
import type {
  Problem,
  ProblemInput,
  ProcessEdge,
  ProcessEdgeInput,
  ProcessEdgeKind,
  ProcessEdgeSide,
  ProcessGroup,
  ProcessGroupInput,
  ProcessNode,
  ProcessNodeDeleteResult,
  ProcessNodeInput,
} from './types'

const NODES = '/problems/process-nodes/'
const EDGES = '/problems/process-edges/'
const GROUPS = '/problems/process-groups/'

export const problemsApi = {
  listProblems: () => request<Problem[]>('/problems/'),
  createProblem: (data: ProblemInput) =>
    request<Problem>('/problems/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateProblem: (id: number, data: Partial<ProblemInput>) =>
    request<Problem>(`/problems/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteProblem: (id: number) =>
    request<void>(`/problems/${id}/`, { method: 'DELETE' }),

  // ---- 회사 프로세스 맵 ----
  listProcessNodes: () => request<ProcessNode[]>(NODES),
  createProcessNode: (data: ProcessNodeInput & { title: string }) =>
    request<ProcessNode>(NODES, { method: 'POST', body: JSON.stringify(data) }),
  updateProcessNode: (id: number, data: Omit<ProcessNodeInput, 'parent'>) =>
    request<ProcessNode>(`${NODES}${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  /** 하위 단계도 함께 지운다. 매달린 문제는 윗단계(맨 위면 미지정)로 옮겨진다 */
  deleteProcessNode: (id: number) =>
    request<ProcessNodeDeleteResult>(`${NODES}${id}/`, { method: 'DELETE' }),
  /** 다른 단계 밑으로(parent null 이면 맨 위로) 옮기고 order 번째 자리에 놓는다 */
  moveProcessNode: (id: number, parent: number | null, order?: number) =>
    request<ProcessNode>(`${NODES}${id}/move/`, {
      method: 'POST',
      body: JSON.stringify(order === undefined ? { parent } : { parent, order }),
    }),
  /** 그래프에서 옮긴 자리를 한꺼번에 저장한다 (그사이 지워진 단계는 건너뛴다) */
  saveProcessPositions: (positions: { id: number; x: number; y: number }[]) =>
    request<{ updated: number }>(`${NODES}positions/`, { method: 'POST', body: JSON.stringify({ positions }) }),
  /** 여러 단계를 한꺼번에: 색('' 이면 기본 색으로)이나 그룹(null 이면 그룹에서 빼기) */
  bulkUpdateProcessNodes: (ids: number[], data: { color?: string; group?: number | null }) =>
    request<{ updated: number }>(`${NODES}bulk-update/`, { method: 'POST', body: JSON.stringify({ ids, ...data }) }),
  /** 맵의 단계 그룹. 만들 때 nodes 의 단계를 묶는다 (다른 그룹에 있던 단계는 옮겨 오고, 빈 그룹은 서버가 지운다) */
  listProcessGroups: () => request<ProcessGroup[]>(GROUPS),
  createProcessGroup: (data: ProcessGroupInput & { title: string; nodes: number[] }) =>
    request<ProcessGroup>(GROUPS, { method: 'POST', body: JSON.stringify(data) }),
  /** 이름·색을 고치거나 nodes 로 멤버를 바꾼다 */
  updateProcessGroup: (id: number, data: ProcessGroupInput) =>
    request<ProcessGroup>(`${GROUPS}${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  /** 그룹 풀기: 단계는 그대로 남는다 */
  deleteProcessGroup: (id: number) => request<void>(`${GROUPS}${id}/`, { method: 'DELETE' }),
  /** 단계 사이 연결 (흐름·되돌아감·관련) */
  listProcessEdges: () => request<ProcessEdge[]>(EDGES),
  createProcessEdge: (data: {
    source: number
    target: number
    kind?: ProcessEdgeKind
    label?: string
    bidirectional?: boolean
    source_side?: ProcessEdgeSide
    target_side?: ProcessEdgeSide
  }) =>
    request<ProcessEdge>(EDGES, { method: 'POST', body: JSON.stringify(data) }),
  /** 이름·종류·양방향·시작점·끝점을 고치거나 {reverse: true} 로 방향을 뒤집는다 */
  updateProcessEdge: (id: number, data: ProcessEdgeInput) =>
    request<ProcessEdge>(`${EDGES}${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProcessEdge: (id: number) => request<void>(`${EDGES}${id}/`, { method: 'DELETE' }),
  /** 단계가 하나도 없을 때만 기본 회사 프로세스를 만든다 */
  seedDefaultProcess: () =>
    request<ProcessNode[]>(`${NODES}seed-default/`, { method: 'POST' }),
}
