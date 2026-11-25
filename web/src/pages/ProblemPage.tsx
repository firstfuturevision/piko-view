import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  api,
  ApiError,
  type Problem,
  type ProcessNode,
  type UserSummary,
} from '../api'
import ProblemList from '../features/problems/ProblemList'
import ProblemModal from '../features/problems/ProblemModal'
import { emptyProblemValues, toProblemInput, type ProblemFormValues } from '../features/problems/problemFormValues'
import { daysLeft, idleDays, STALE_DAYS } from '../features/problems/problemFlags'
import Button from '../components/ui/Button'
import ErrorBanner from '../components/ui/ErrorBanner'
import PageHeader from '../components/ui/PageHeader'
import { useLabel } from '../view/template'

// 문제 해결: 목록과 위쪽 '살펴볼 문제' 띠. 프로세스 단계(있으면)는 문제 창에서 고른다
export default function ProblemPage() {
  const navigate = useNavigate()
  const label = useLabel()
  const [problems, setProblems] = useState<Problem[]>([])
  const [nodes, setNodes] = useState<ProcessNode[]>([])
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ProblemFormValues>(emptyProblemValues)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    try {
      const [problemList, userList, nodeList] = await Promise.all([
        api.listProblems(),
        api.listUsers(),
        // 프로세스 단계는 없어도 된다 (서버에 없으면 빈 목록)
        api.listProcessNodes().catch(() => [] as ProcessNode[]),
      ])
      setProblems(problemList)
      setUsers(userList)
      setNodes(nodeList)
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        navigate('/login', { replace: true })
        return
      }
      setError(err instanceof Error ? err.message : '문제를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 응답(await) 뒤에만 상태를 바꾼다
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreate() {
    setEditingId(null)
    setForm({ ...emptyProblemValues })
    setModalOpen(true)
  }

  function openEdit(p: Problem) {
    setEditingId(p.id)
    setForm({
      definition: p.definition,
      impact: p.impact,
      resolve_condition: p.resolve_condition,
      result: p.result ?? '',
      time_budget: p.time_budget,
      due_date: p.due_date ?? '',
      status: p.status,
      unknowns: p.unknowns,
      assignee: p.assignee ?? '',
      process: p.process ?? '',
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyProblemValues)
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      if (editingId === null) {
        await api.createProblem(toProblemInput(form))
      } else {
        await api.updateProblem(editingId, toProblemInput(form))
      }
      closeModal()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteProblem(id)
      closeModal()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.')
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <PageHeader
        className="mb-6 shrink-0"
        title={label('problems', '문제 해결')}
        actions={
          <Button variant="primary" onClick={openCreate} data-tip="막힌 문제를 정의와 결정 기한과 함께 등록합니다">
            + 새 문제
          </Button>
        }
      />
      <ErrorBanner className="mb-4 shrink-0">{error}</ErrorBanner>
      {!loading && <Attention problems={problems} onOpen={openEdit} />}
      {loading ? (
        <p className="py-8 text-center text-slate-400">불러오는 중...</p>
      ) : (
        <ProblemList problems={problems} onOpen={openEdit} />
      )}
      <ProblemModal
        open={modalOpen}
        editing={editingId !== null}
        values={form}
        users={users}
        processNodes={nodes}
        submitting={submitting}
        onChange={setForm}
        onSubmit={handleSubmit}
        onClose={closeModal}
        onDelete={editingId !== null ? () => void handleDelete(editingId) : undefined}
      />
    </main>
  )
}

/** 결정 기한이 지났거나 오래 그대로인 문제를 위에 모아 보여 준다 (모두에게 같은 목록) */
function Attention({
  problems,
  onOpen,
}: {
  problems: Problem[]
  onOpen: (p: Problem) => void
}) {
  const overdue = problems.filter((p) => (daysLeft(p) ?? 0) < 0)
  const stale = problems.filter((p) => idleDays(p) !== null && !overdue.includes(p))
  if (overdue.length === 0 && stale.length === 0) return null
  return (
    <section
      aria-label="살펴볼 문제"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm"
    >
      <p className="font-semibold text-amber-800">
        살펴볼 문제 {overdue.length + stale.length}건
        <span className="ml-2 font-normal text-amber-700">
          {overdue.length > 0 && `결정 기한 지남 ${overdue.length}`}
          {overdue.length > 0 && stale.length > 0 && ' · '}
          {stale.length > 0 && `${STALE_DAYS}일 넘게 그대로 ${stale.length}`}
        </span>
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {[...overdue, ...stale].map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen(p)}
              data-tip="눌러서 이 문제 상세를 엽니다"
              className="max-w-[22rem] truncate rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 shadow-sm hover:bg-amber-100"
            >
              {p.definition}
              {p.assignee_name ? ` · ${p.assignee_name}` : ' · 오너 없음'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
