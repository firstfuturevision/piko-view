import { useEffect, useRef, useState } from 'react'
import type { Category } from '../../api'
import {
  DEFAULT_COLOR,
  SCHEDULE_COLORS,
  UNCATEGORIZED_STYLE,
  type ScheduleColor,
} from '../../lib/colors'
import ColorPicker from '../../components/ColorPicker'
import { useConfirm } from '../../components/useConfirm'

export type CategoryKey = number | 'none'

interface Props {
  categories: Category[]
  /** 체크 해제된(숨김) 카테고리 키 목록 */
  excluded: Set<CategoryKey>
  onToggle: (key: CategoryKey) => void
  /** 전체선택 체크박스: checked=true면 모두 표시, false면 모두 숨김 */
  onToggleAll: (showAll: boolean) => void
  onCreate: (name: string, color: ScheduleColor) => Promise<Category>
  onUpdate: (id: number, name: string, color: ScheduleColor) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

export default function CategoryFilter({
  categories,
  excluded,
  onToggle,
  onToggleAll,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const [ask, confirmEl] = useConfirm()
  const allChecked = excluded.size === 0
  const keyCount = categories.length + 1 // + 미분류
  const noneChecked =
    excluded.size >= keyCount &&
    categories.every((c) => excluded.has(c.id)) &&
    excluded.has('none')
  const allRef = useRef<HTMLInputElement>(null)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<ScheduleColor>(DEFAULT_COLOR)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<ScheduleColor>(DEFAULT_COLOR)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = !allChecked && !noneChecked
    }
  }, [allChecked, noneChecked])

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await onCreate(trimmed, color)
      setName('')
      setColor(DEFAULT_COLOR)
      setAdding(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '카테고리 생성에 실패했습니다.')
    }
  }

  function startEdit(c: Category) {
    setEditingId(c.id)
    setEditName(c.name)
    setEditColor(c.color)
    setError(null)
  }

  async function handleUpdate() {
    if (editingId === null) return
    const trimmed = editName.trim()
    if (!trimmed) return
    try {
      await onUpdate(editingId, trimmed, editColor)
      setEditingId(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '카테고리 수정에 실패했습니다.')
    }
  }

  async function handleDelete(c: Category) {
    if (!(await ask({ title: '카테고리 삭제', message: `'${c.name}' 카테고리를 삭제할까요?\n해당 일정들은 미분류로 남습니다.` }))) return
    try {
      await onDelete(c.id)
      if (editingId === c.id) setEditingId(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '카테고리 삭제에 실패했습니다.')
    }
  }

  return (
    <div className="rounded-xl bg-white p-4 border border-slate-200/80">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">카테고리</h2>
      <label
        data-tip="모든 카테고리를 한 번에 보이거나 숨깁니다"
        className="mb-1 flex cursor-pointer items-center gap-2 rounded-lg border-b border-slate-100 px-2 py-1.5 pb-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
        <input
          ref={allRef}
          type="checkbox"
          checked={allChecked}
          onChange={() => onToggleAll(!allChecked)}
          className="h-4 w-4 accent-blue-600"
        />
        전체선택
      </label>
      <ul className="space-y-1">
        {categories.map((c) =>
          editingId === c.id ? (
            <li
              key={c.id}
              className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2"
            >
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleUpdate()
                }}
                autoFocus
                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <ColorPicker value={editColor} onChange={setEditColor} size="h-5 w-5" />
              <div className="flex gap-1.5">
                <button
                  onClick={() => void handleUpdate()}
                  className="flex-1 rounded-lg bg-blue-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  저장
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100"
                >
                  취소
                </button>
              </div>
            </li>
          ) : (
            <li key={c.id} className="group flex items-center">
              <label
                data-tip="체크를 끄면 이 카테고리 일정이 달력과 목록에서 숨겨집니다"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={!excluded.has(c.id)}
                  onChange={() => onToggle(c.id)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${SCHEDULE_COLORS[c.color].dot}`}
                />
                <span className="truncate">{c.name}</span>
              </label>
              <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                <button
                  onClick={() => startEdit(c)}
                  data-tip="카테고리 이름과 색을 바꿉니다"
                  aria-label={`${c.name} 수정`}
                  className="rounded px-1 py-0.5 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  ✎
                </button>
                <button
                  onClick={() => void handleDelete(c)}
                  data-tip="카테고리를 삭제합니다. 일정은 미분류로 남습니다"
                  aria-label={`${c.name} 삭제`}
                  className="rounded px-1 py-0.5 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                >
                  ✕
                </button>
              </span>
            </li>
          ),
        )}
        <li>
          <label
            data-tip="카테고리가 없는 일정을 보이거나 숨깁니다"
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={!excluded.has('none')}
              onChange={() => onToggle('none')}
              className="h-4 w-4 accent-blue-600"
            />
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${UNCATEGORIZED_STYLE.dot}`}
            />
            <span className="text-slate-400">미분류</span>
          </label>
        </li>
      </ul>

      {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}

      <div className="mt-3 border-t border-slate-100 pt-3">
        {adding ? (
          <div className="space-y-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
              }}
              placeholder="카테고리 이름"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <ColorPicker value={color} onChange={setColor} size="h-5 w-5" />
            <div className="flex gap-1.5">
              <button
                onClick={() => void handleCreate()}
                className="flex-1 rounded-lg bg-blue-600 px-2 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                생성
              </button>
              <button
                onClick={() => {
                  setAdding(false)
                  setName('')
                  setError(null)
                }}
                className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            data-tip="일정을 나눌 카테고리를 이름과 색으로 만듭니다"
            className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-sm text-slate-500 transition hover:bg-slate-50"
          >
            + 카테고리 추가
          </button>
        )}
      </div>
      {confirmEl}
    </div>
  )
}
