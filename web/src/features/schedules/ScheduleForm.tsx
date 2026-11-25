import { useState, type FormEvent } from 'react'
import type { Category, ScheduleRepeat } from '../../api'
import { DEFAULT_COLOR, type ScheduleColor } from '../../lib/colors'
import ColorPicker from '../../components/ColorPicker'
import DateTimeField from './DateTimeField'
import { repeatLabel } from './repeat'
import { type ScheduleFormValues } from './scheduleFormValues'

/** 하루종일 토글 시 date ↔ datetime-local 값 변환 */
function convertValues(
  values: ScheduleFormValues,
  allDay: boolean,
): ScheduleFormValues {
  const toDate = (v: string) => v.slice(0, 10)
  const toDateTime = (v: string) => (v ? `${v.slice(0, 10)}T09:00` : '')
  return {
    ...values,
    all_day: allDay,
    start_at: allDay ? toDate(values.start_at) : toDateTime(values.start_at),
    end_at: allDay ? toDate(values.end_at) : toDateTime(values.end_at),
  }
}

interface Props {
  values: ScheduleFormValues
  categories: Category[]
  editing: boolean
  submitting: boolean
  onChange: (values: ScheduleFormValues) => void
  onCreateCategory: (name: string, color: ScheduleColor) => Promise<Category>
  onSubmit: () => void
  onCancel: () => void
  /** 수정 모드에서만 전달됨. 클릭 시 삭제 플로우 시작 */
  onDelete?: () => void
}

export default function ScheduleForm({
  values,
  categories,
  editing,
  submitting,
  onChange,
  onCreateCategory,
  onSubmit,
  onCancel,
  onDelete,
}: Props) {
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryColor, setNewCategoryColor] =
    useState<ScheduleColor>(DEFAULT_COLOR)
  const [addingCategory, setAddingCategory] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit()
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim()
    if (!name) return
    const created = await onCreateCategory(name, newCategoryColor)
    onChange({ ...values, category: created.id })
    setNewCategoryName('')
    setNewCategoryColor(DEFAULT_COLOR)
    setAddingCategory(false)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        <input
          type="text"
          placeholder="제목"
          value={values.title}
          onChange={(e) => onChange({ ...values, title: e.target.value })}
          required
          autoFocus
          className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <button
            type="button"
            role="switch"
            aria-checked={values.all_day}
            data-tip="켜면 시간 없이 날짜만 정합니다"
            onClick={() => onChange(convertValues(values, !values.all_day))}
            className={`relative h-6 w-11 rounded-full transition ${
              values.all_day ? 'bg-blue-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                values.all_day ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
          하루종일
        </label>

        <DateTimeField
          label="시작"
          value={values.start_at}
          allDay={values.all_day}
          required
          onChange={(v) => onChange({ ...values, start_at: v })}
        />
        <DateTimeField
          label="종료"
          value={values.end_at}
          allDay={values.all_day}
          onChange={(v) => onChange({ ...values, end_at: v })}
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-sm text-slate-600">반복</span>
          <select
            value={values.repeat}
            aria-label="반복"
            data-tip="시작 날짜의 요일·날짜로 되풀이합니다"
            onChange={(e) =>
              onChange({ ...values, repeat: e.target.value as ScheduleRepeat })
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">안 함</option>
            <option value="weekly">{repeatLabel('weekly', values.start_at)}</option>
            <option value="monthly">{repeatLabel('monthly', values.start_at)}</option>
          </select>
          {values.repeat && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              끝나는 날
              <input
                type="date"
                aria-label="반복 끝나는 날"
                value={values.repeat_until}
                min={values.start_at.slice(0, 10) || undefined}
                onChange={(e) => onChange({ ...values, repeat_until: e.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <span className="text-xs text-slate-400">비우면 계속</span>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-sm text-slate-600">카테고리</span>
          <select
            value={values.category ?? ''}
            data-tip="카테고리 색으로 달력에 표시되고, 필터에 쓰입니다"
            onChange={(e) =>
              onChange({
                ...values,
                category: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">없음</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {!addingCategory && (
            <button
              type="button"
              onClick={() => setAddingCategory(true)}
            data-tip="여기서 바로 카테고리를 만들어 고릅니다"
              className="rounded-lg border border-dashed border-slate-300 px-2.5 py-2 text-sm text-slate-500 transition hover:bg-slate-50"
            >
              + 새 카테고리
            </button>
          )}
        </div>

        {addingCategory && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleAddCategory()
                  }
                }}
                placeholder="카테고리 이름"
                autoFocus
                className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleAddCategory()}
                className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                생성
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingCategory(false)
                  setNewCategoryName('')
                }}
                className="rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                취소
              </button>
            </div>
            <ColorPicker value={newCategoryColor} onChange={setNewCategoryColor} />
          </div>
        )}

        <textarea
          placeholder="설명 (선택)"
          value={values.description}
          onChange={(e) => onChange({ ...values, description: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div className="mt-5 flex items-center gap-2">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-500 transition hover:bg-red-50"
          >
            삭제
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {editing ? '저장' : '추가'}
          </button>
        </div>
      </div>
    </form>
  )
}
