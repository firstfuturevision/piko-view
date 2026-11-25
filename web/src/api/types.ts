import type { ScheduleColor } from '../lib/colors'

// ---------- 인증 ----------

export interface Profile {
  username: string
  nickname: string
  date_joined: string
  last_login: string | null
  is_staff: boolean
  /** 내 정보의 역할 (맡는 일·잘하는 것·맡지 않는 것) */
  role: string
}

export interface UserSummary {
  id: number
  username: string
  nickname: string
  /** 본인이 내 정보에 적은 역할. 비어 있을 수 있다 */
  role?: string
}

// ---------- 일정 ----------

export type ScheduleRepeat = '' | 'weekly' | 'monthly'

export interface Schedule {
  id: number
  title: string
  description: string
  start_at: string
  end_at: string | null
  is_all_day: boolean
  category: number | null
  category_name: string | null
  category_color: ScheduleColor | null
  owner_username: string
  is_done: boolean
  is_pinned: boolean
  created_at: string
  updated_at: string
  /** 반복: '' 안 함 · weekly 매주(시작 요일) · monthly 매월(시작 날짜). 화면에서 합성한 항목에는 없다 */
  repeat?: ScheduleRepeat
  /** 반복이 끝나는 날 YYYY-MM-DD (null 이면 계속) */
  repeat_until?: string | null
  /** 화면에서 합성한 항목(음수 id)의 구분 이름 — 예: '서비스 갱신'. 서버 일정에는 없다 */
  virtual_label?: string
}

export type ScheduleInput = Pick<
  Schedule,
  'title' | 'description' | 'start_at' | 'end_at' | 'is_all_day' | 'category' | 'repeat' | 'repeat_until'
>

export interface Category {
  id: number
  name: string
  color: ScheduleColor
}

// ---------- 문제 해결 ----------

export type ProblemStatus = 'open' | 'solving' | 'on_hold' | 'solved' | 'paused'

export interface ProblemUnknown {
  text: string
  /** 가장 위험한 가정 표시 (문제당 최대 1개) */
  riskiest: boolean
}

export interface Problem {
  id: number
  /** 문제의 정의: 지금 무엇이 어떻게 막혀 있는지 (한 문장) */
  definition: string
  /** 풀지 않았을 때 어떻게 되는지 */
  impact: string
  /** 끝나는 조건 */
  resolve_condition: string
  /** 어떻게 풀었나 (해결·중단할 때 푼 방법이나 멈춘 이유) */
  result: string
  /** 들일 시간 */
  time_budget: string
  /** 결정 기한 — 들일 시간이 끝나는 날 */
  due_date: string | null
  status: ProblemStatus
  unknowns: ProblemUnknown[]
  /** 문제의 오너 (사용자 id) */
  assignee: number | null
  assignee_name: string | null
  /** 이 문제가 생긴 회사 프로세스 단계 (ProcessNode id). 없으면 '프로세스 미지정' */
  process: number | null
  /** '제작 › 개발' 처럼 맨 위 단계부터 이은 이름 */
  process_path: string | null
  owner_username: string
  created_at: string
  updated_at: string
}

/** 프로세스 단계 하나에 매달린 문제 수. *_count 는 그 단계만, *_total 은 하위 단계까지 합친 것 */
export interface ProcessNodeCounts {
  by_status: Record<ProblemStatus, number>
  by_status_total: Record<ProblemStatus, number>
  /** 끝나지 않은 문제 (미해결·해결 중·보류) */
  open_count: number
  open_total: number
  problem_count: number
  problem_total: number
  /** 끝나지 않았는데 결정 기한이 지난 문제 */
  overdue_count: number
  overdue_total: number
}

/** 회사 프로세스 맵의 한 단계. 목록은 평평하게 오고 parent 로 나무를 짓는다 */
export interface ProcessNode {
  id: number
  title: string
  description: string
  /** 윗단계 id ('하위 단계' 묶음 — 문제 수를 하위 포함으로 센다). null 이면 맨 위 단계 */
  parent: number | null
  /** 같은 윗단계 안 순서 (0부터) */
  order: number
  /** 짧은 색 이름 (blue, violet …). 빈 글이면 기본색 */
  color: string
  /** 흐름 밖 지원 단계 (회사 운영 등) — 회사를 받치는 일 */
  is_support: boolean
  /** 맵에서 함께 묶어 보이는 그룹 (ProcessGroup id). 한 단계는 그룹 하나에만 든다 */
  group: number | null
  /** 그래프에 놓인 자리 (가운데). 비어 있으면 화면이 자동으로 놓고 저장한다 */
  x: number | null
  y: number | null
  path: string
  depth: number
  counts: ProcessNodeCounts
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export type ProcessNodeInput = Partial<
  Pick<ProcessNode, 'title' | 'description' | 'parent' | 'order' | 'color' | 'is_support' | 'group' | 'x' | 'y'>
>

/** 맵에서 여러 단계를 한 테두리로 묶은 그룹 (나무와 상관없이 아무 단계나) */
export interface ProcessGroup {
  id: number
  title: string
  /** 짧은 색 이름 (blue, violet …). 빈 글이면 회색 */
  color: string
  /** 멤버 단계 id (순서대로) */
  nodes: number[]
  /** 멤버와 그 하위 단계에 매달린 문제 수 (멤버끼리 위아래로 겹쳐도 한 번씩) */
  counts: { open: number; overdue: number; problem_total: number }
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export type ProcessGroupInput = Partial<Pick<ProcessGroup, 'title' | 'color' | 'nodes'>>

/** 단계 사이 연결 종류: 흐름(다음 단계로) · 되돌아감(앞 단계로 돌아가는 고리) · 관련(방향 없는 이어짐) */
export type ProcessEdgeKind = 'flow' | 'loop' | 'related'

/** 선이 나가고 들어오는 카드 변. '' 은 두 카드 자리를 보고 자동 */
export type ProcessEdgeSide = '' | 'left' | 'right' | 'top' | 'bottom'

/** 두 프로세스 단계를 잇는 화살표 */
export interface ProcessEdge {
  id: number
  source: number
  target: number
  /** 연결 이름 (예: 수정 요청). 빈 글이면 이름 없음 */
  label: string
  kind: ProcessEdgeKind
  /** 양쪽 다 화살표 */
  bidirectional: boolean
  /** 선이 나가는 source 카드 변 ('' 은 자동) */
  source_side: ProcessEdgeSide
  /** 선이 들어오는 target 카드 변 ('' 은 자동) */
  target_side: ProcessEdgeSide
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export type ProcessEdgeInput = Partial<
  Pick<ProcessEdge, 'label' | 'kind' | 'bidirectional' | 'source_side' | 'target_side'>
> & {
  /** true 면 방향(source ↔ target)을 뒤집는다 (시작점·끝점도 서버가 함께 바꾼다) */
  reverse?: boolean
}

export interface ProcessNodeDeleteResult {
  deleted: number
  moved_problems: number
  moved_to: { id: number; title: string } | null
  /** 사람에게 그대로 보여 줄 한 줄 ('… 문제 2건은 '제작' 단계로 옮겼습니다.') */
  message: string
}

export type ProblemInput = Pick<
  Problem,
  | 'definition'
  | 'impact'
  | 'resolve_condition'
  | 'result'
  | 'time_budget'
  | 'due_date'
  | 'status'
  | 'unknowns'
  | 'assignee'
  | 'process'
>

// ---------- 문서 ----------
