import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type Category, type Schedule } from '../api'
import CalendarView from '../features/schedules/CalendarView'
import CategoryFilter, {
  type CategoryKey,
} from '../features/schedules/CategoryFilter'
import { emptyFormValues, type ScheduleFormValues } from '../features/schedules/scheduleFormValues'
import ScheduleModal from '../features/schedules/ScheduleModal'
import ScheduleList from '../features/schedules/ScheduleList'
import type { ScheduleColor } from '../lib/colors'
import {
  toInputValue,
  toLocalDateInput,
  toLocalInput,
} from '../lib/datetime'
import { useLabel } from '../view/template'

export default function SchedulePage() {
  const navigate = useNavigate()
  const label = useLabel()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  // 체크 해제된(숨김) 카테고리 키. 비어 있으면 전체 표시 — 새 카테고리도 자동으로 보인다.
  const [excluded, setExcluded] = useState<Set<CategoryKey>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ScheduleFormValues>(emptyFormValues)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function refresh() {
    try {
      const [scheduleList, categoryList] = await Promise.all([
        api.listSchedules(),
        api.listCategories(),
      ])
      setSchedules(scheduleList)
      // 만든 사람은 서버가 아이디로 주므로 닉네임으로 바꿔 보인다 (못 불러오면 아이디 그대로)
      api
        .listUsers()
        .then((users) => {
          const name = new Map(users.map((u) => [u.username, u.nickname || u.username]))
          setSchedules(scheduleList.map((x) => ({ ...x, owner_username: name.get(x.owner_username) ?? x.owner_username })))
        })
        .catch(() => {})
      setCategories(categoryList)
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        navigate('/login', { replace: true })
        return
      }
      setError(err instanceof Error ? err.message : '일정을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 응답(await) 뒤에만 상태를 바꾼다
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = schedules.filter((s) => !excluded.has(s.category ?? 'none'))

  const calendarItems = filtered

  function toggleCategoryKey(key: CategoryKey) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function openCreate(date?: Date) {
    setEditingId(null)
    const base = { ...emptyFormValues }
    if (date) {
      // 클릭한 날짜 + 현재 시각(5분 단위 올림)으로 시작, 종료는 +1시간
      const now = new Date()
      const start = new Date(date)
      start.setHours(now.getHours(), Math.ceil(now.getMinutes() / 5) * 5, 0, 0)
      const end = new Date(start.getTime() + 60 * 60 * 1000)
      base.start_at = toInputValue(start)
      base.end_at = toInputValue(end)
    }
    setForm(base)
    setModalOpen(true)
  }

  function openEdit(s: Schedule) {
    // 달력의 반복 발생분을 눌러도 원본(첫 날짜)을 고친다
    const orig = schedules.find((x) => x.id === s.id) ?? s
    setEditingId(orig.id)
    setForm({
      repeat: orig.repeat ?? '',
      repeat_until: orig.repeat_until ?? '',
      title: orig.title,
      description: orig.description,
      all_day: orig.is_all_day,
      category: orig.category,
      start_at: orig.is_all_day
        ? toLocalDateInput(orig.start_at)
        : toLocalInput(orig.start_at),
      end_at: orig.is_all_day ? toLocalDateInput(orig.end_at) : toLocalInput(orig.end_at),
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setForm(emptyFormValues)
  }

  async function handleCreateCategory(
    name: string,
    color: ScheduleColor,
  ): Promise<Category> {
    const created = await api.createCategory(name, color)
    setCategories((prev) =>
      [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
    )
    return created
  }

  async function handleUpdateCategory(
    id: number,
    name: string,
    color: ScheduleColor,
  ): Promise<void> {
    await api.updateCategory(id, { name, color })
    // 색이 바뀌면 일정 표시색도 함께 갱신돼야 하므로 전체 새로고침
    await refresh()
  }

  async function handleDeleteCategory(id: number): Promise<void> {
    await api.deleteCategory(id)
    // 해당 일정들은 서버에서 미분류(SET_NULL)로 남는다
    setExcluded((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (form.category === id) setForm({ ...form, category: null })
    await refresh()
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    // 하루종일 일정은 로컬 자정 기준으로 저장한다.
    const toIso = (v: string) =>
      new Date(form.all_day ? `${v}T00:00` : v).toISOString()
    const payload = {
      title: form.title,
      description: form.description,
      is_all_day: form.all_day,
      category: form.category,
      start_at: toIso(form.start_at),
      end_at: form.end_at ? toIso(form.end_at) : null,
      repeat: form.repeat,
      repeat_until: form.repeat && form.repeat_until ? form.repeat_until : null,
    }
    try {
      if (editingId === null) {
        await api.createSchedule(payload)
      } else {
        await api.updateSchedule(editingId, payload)
      }
      closeModal()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleDone(s: Schedule) {
    try {
      await api.updateSchedule(s.id, { is_done: !s.is_done })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '변경에 실패했습니다.')
    }
  }

  async function togglePin(s: Schedule) {
    try {
      await api.updateSchedule(s.id, { is_pinned: !s.is_pinned })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '변경에 실패했습니다.')
    }
  }

  // 삭제 확인은 ScheduleList의 ConfirmDialog에서 처리한다.
  async function handleDelete(id: number) {
    try {
      await api.deleteSchedule(id)
      if (editingId === id) closeModal()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.')
    }
  }

  return (
    <>
    {/* 넓은 화면: 본문 높이를 채우고 카테고리 | 달력 | 목록이 따로 스크롤한다 (lg~xl 은 달력 아래에 목록) */}
    <main className="px-6 py-6 lg:flex lg:h-full lg:flex-col">
      {error && (
        <p role="alert" className="mb-4 shrink-0 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-slate-800">{label('schedules', '일정')}</h2>
        </div>
        <button
          onClick={() => openCreate()}
          data-tip="새 일정을 추가합니다. 달력의 날짜를 눌러도 됩니다"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          + 새 일정
        </button>
      </div>

        {loading ? (
          <p className="py-8 text-center text-slate-400">불러오는 중...</p>
        ) : (
          <div className="flex flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row">
            <aside className="w-full shrink-0 lg:w-48 lg:scroll-pane">
              <CategoryFilter
                categories={categories}
                excluded={excluded}
                onToggle={toggleCategoryKey}
                onToggleAll={(showAll) =>
                  setExcluded(
                    showAll
                      ? new Set()
                      : new Set<CategoryKey>([
                          ...categories.map((c) => c.id),
                          'none',
                        ]),
                  )
                }
                onCreate={handleCreateCategory}
                onUpdate={handleUpdateCategory}
                onDelete={handleDeleteCategory}
              />
            </aside>
            <div className="flex min-w-0 flex-1 flex-col gap-6 lg:scroll-pane xl:flex-row">
            {/* lg~xl 은 달력 제 높이 그대로, xl 부터는 칸 높이를 채우되 최소 높이 이하로는 줄어들지 않게 (창이 아주 낮으면 달력·목록 칸이 함께 스크롤) */}
            <div className="min-w-0 lg:shrink-0 xl:min-h-[560px] xl:flex-1">
              <CalendarView
                schedules={calendarItems}
                onSelectSchedule={openEdit}
                onSelectDate={openCreate}
              />
            </div>
            <aside className="w-full shrink-0 xl:w-96 xl:scroll-pane 2xl:w-120">
              <ScheduleList
                schedules={filtered}
                onToggleDone={toggleDone}
                onTogglePin={togglePin}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            </aside>
            </div>
          </div>
        )}
      </main>

      <ScheduleModal
        open={modalOpen}
        editing={editingId !== null}
        values={form}
        categories={categories}
        submitting={submitting}
        onChange={setForm}
        onCreateCategory={handleCreateCategory}
        onSubmit={handleSubmit}
        onClose={closeModal}
        onDelete={
          editingId !== null ? () => void handleDelete(editingId) : undefined
        }
      />

    </>
  )
}
