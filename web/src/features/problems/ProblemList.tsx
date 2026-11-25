import { useMemo, useState } from 'react'
import type { Problem, ProblemStatus } from '../../api'
import EmptyState from '../../components/ui/EmptyState'
import StatusChip from '../../components/ui/StatusChip'
import type { StatusTone } from '../../components/ui/statusTone'
import { PROBLEM_STATUS_META } from '../../lib/labels'
import { daysLeft, idleDays } from './problemFlags'

type Show = 'active' | 'done' | 'all'
type Sort = 'due' | 'idle' | 'new'

const TONE: Record<ProblemStatus, StatusTone> = {
  open: 'neutral',
  solving: 'info',
  on_hold: 'warning',
  solved: 'success',
  paused: 'danger',
}
const ACTIVE: ProblemStatus[] = ['open', 'solving', 'on_hold']
const DAY = 24 * 60 * 60 * 1000

function shortDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear() % 100}.${d.getMonth() + 1}.${d.getDate()}`
}

/** 결정 기한 칸: 'D-3', '3일 지남', 끝난 문제는 날짜만 */
function dueText(p: Problem): { text: string; late: boolean } {
  if (!p.due_date) return { text: '-', late: false }
  const left = daysLeft(p)
  if (left === null) return { text: p.due_date.slice(2).replaceAll('-', '.'), late: false }
  if (left < 0) return { text: `${-left}일 지남`, late: true }
  return { text: left === 0 ? '오늘' : `D-${left}`, late: false }
}

/** 마지막으로 고친 뒤 지난 날 */
function idleText(p: Problem) {
  const days = Math.floor((Date.now() - Date.parse(p.updated_at)) / DAY)
  return days <= 0 ? '오늘' : `${days}일 전`
}

/**
 * 문제 목록: 상태·오너·단계·결정 기한·등록일·마지막 변경을 한눈에. 안 끝난 것만 / 끝난 것만 / 전체로 거르고,
 * 기한 가까운 순·오래 그대로인 순·최근 등록 순으로 줄 세우고, 글자로 찾는다(정의·영향·끝나는 조건·어떻게 풀었나).
 */
export default function ProblemList({ problems, onOpen }: { problems: Problem[]; onOpen: (p: Problem) => void }) {
  const [show, setShow] = useState<Show>('active')
  const [sort, setSort] = useState<Sort>('due')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = problems.filter((p) => {
      const active = ACTIVE.includes(p.status)
      if (show === 'active' && !active) return false
      if (show === 'done' && active) return false
      if (!needle) return true
      return [p.definition, p.impact, p.resolve_condition, p.result ?? '', p.assignee_name ?? '', p.process_path ?? '']
        .some((t) => t.toLowerCase().includes(needle))
    })
    const due = (p: Problem) => (p.due_date ? Date.parse(p.due_date) : Number.MAX_SAFE_INTEGER)
    return [...list].sort((a, b) =>
      sort === 'due'
        ? due(a) - due(b) || Date.parse(a.updated_at) - Date.parse(b.updated_at)
        : sort === 'idle'
          ? Date.parse(a.updated_at) - Date.parse(b.updated_at)
          : Date.parse(b.created_at) - Date.parse(a.created_at),
    )
  }, [problems, show, sort, q])

  const counts = {
    active: problems.filter((p) => ACTIVE.includes(p.status)).length,
    done: problems.filter((p) => !ACTIVE.includes(p.status)).length,
  }
  const select = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none'

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="보기" value={show} onChange={(e) => setShow(e.target.value as Show)} className={select}>
          <option value="active">안 끝난 문제 {counts.active}</option>
          <option value="done">해결·중단 {counts.done}</option>
          <option value="all">전체 {problems.length}</option>
        </select>
        <select aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={select}>
          <option value="due">결정 기한 가까운 순</option>
          <option value="idle">오래 그대로인 순</option>
          <option value="new">최근 등록 순</option>
        </select>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="찾기 (정의·끝나는 조건·어떻게 풀었나)"
          aria-label="문제 찾기"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none sm:w-72"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState compact>
          {q ? '찾는 문제가 없습니다.' : show === 'done' ? '해결하거나 중단한 문제가 아직 없습니다.' : '안 끝난 문제가 없습니다.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-white">
          {rows.map((p) => {
            const due = dueText(p)
            const idle = idleDays(p)
            return (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p)} className="block w-full px-4 py-3 text-left hover:bg-slate-50">
                  <div className="flex items-start gap-2">
                    <StatusChip tone={TONE[p.status]} className="mt-0.5">
                      {PROBLEM_STATUS_META[p.status].label}
                    </StatusChip>
                    <span className="min-w-0 flex-1 text-[15px] font-semibold text-slate-900">{p.definition}</span>
                  </div>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-500 sm:flex sm:flex-wrap sm:gap-x-5">
                    <div>
                      <dt className="inline text-slate-400">오너 </dt>
                      <dd className={`inline ${p.assignee_name ? '' : 'text-amber-600'}`}>{p.assignee_name ?? '없음'}</dd>
                    </div>
                    <div>
                      <dt className="inline text-slate-400">결정 기한 </dt>
                      <dd className={`inline ${due.late ? 'font-semibold text-rose-600' : ''}`}>{due.text}</dd>
                    </div>
                    <div className="truncate">
                      <dt className="inline text-slate-400">단계 </dt>
                      <dd className="inline">{p.process_path ?? '미지정'}</dd>
                    </div>
                    <div>
                      <dt className="inline text-slate-400">등록 </dt>
                      <dd className="inline">{shortDate(p.created_at)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-slate-400">마지막 변경 </dt>
                      <dd className={`inline ${idle !== null ? 'text-amber-600' : ''}`}>{idleText(p)}</dd>
                    </div>
                  </dl>
                  {(p.result || p.resolve_condition) && (
                    <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">
                      <span className="text-slate-400">{p.result ? '어떻게 풀었나 ' : '끝나는 조건 '}</span>
                      {p.result || p.resolve_condition}
                    </p>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
