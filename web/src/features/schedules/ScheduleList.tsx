import { useState } from 'react'
import type { Schedule } from '../../api'
import { colorStyleOf } from '../../lib/colors'
import { dateKey, formatDate, formatTime } from '../../lib/datetime'
import { repeatLabel } from './repeat'
import ConfirmDialog from '../../components/ConfirmDialog'
import type { MenuEntry } from '../../components/ui/menuEntries'
import { useContextMenu } from '../../components/ui/useContextMenu'

interface Props {
  schedules: Schedule[]
  onToggleDone: (s: Schedule) => void
  onTogglePin: (s: Schedule) => void
  onEdit: (s: Schedule) => void
  onDelete: (id: number) => void
}

// 완료한 일정 보기 (이 브라우저에 기억)
const SHOW_DONE_KEY = 'schedules.showDone'

function savedShowDone(): boolean {
  try {
    return localStorage.getItem(SHOW_DONE_KEY) === '1'
  } catch {
    return false
  }
}

function formatGroupDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export default function ScheduleList({
  schedules,
  onToggleDone,
  onTogglePin,
  onEdit,
  onDelete,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null)
  const [showDone, setShowDoneState] = useState(savedShowDone)
  // 일정 우클릭 메뉴: 고치기·완료·고정·삭제 (줄 안 체크·별·휴지통과 같은 동작)
  const menu = useContextMenu(
    (s: Schedule): MenuEntry[] => [
      { label: '고치기', icon: '✎', onSelect: () => onEdit(s) },
      { label: s.is_done ? '완료 풀기' : '완료로 표시', icon: '✓', onSelect: () => onToggleDone(s) },
      {
        label: s.is_pinned ? '고정 풀기' : '맨 위에 고정',
        icon: '★',
        tip: s.is_pinned ? '고정을 풀어 날짜 순서로 돌려놓습니다' : '목록 맨 위 고정됨 칸에 올려 둡니다',
        onSelect: () => onTogglePin(s),
      },
      'divider',
      { label: '삭제', icon: '🗑', danger: true, onSelect: () => setPendingDelete(s) },
    ],
    { label: '일정 메뉴', width: 170 },
  )

  function setShowDone(v: boolean) {
    setShowDoneState(v)
    try {
      localStorage.setItem(SHOW_DONE_KEY, v ? '1' : '0')
    } catch {
      // 기억하지 못해도 이번 화면에서는 따른다
    }
  }

  const doneCount = schedules.filter((s) => s.is_done).length
  const visible = showDone ? schedules : schedules.filter((s) => !s.is_done)
  const doneToggle = doneCount > 0 && (
    <label
      data-tip="완료로 체크한 일정을 목록에 함께 보입니다 (달력에는 늘 보입니다)"
      className="mb-2 flex cursor-pointer items-center justify-end gap-1.5 text-xs text-slate-500"
    >
      <input
        type="checkbox"
        checked={showDone}
        onChange={(e) => setShowDone(e.target.checked)}
        className="h-3.5 w-3.5 accent-blue-600"
      />
      완료한 일정 보기 <span className="text-slate-400 tabular-nums">({doneCount})</span>
    </label>
  )

  if (visible.length === 0) {
    return (
      <>
        {doneToggle}
        <p className="py-8 text-center text-sm text-slate-400">
          {schedules.length === 0 ? '등록된 일정이 없습니다.' : '남은 일정이 없습니다. 완료한 일정은 숨겨 두었습니다.'}
        </p>
      </>
    )
  }

  const pinned = visible.filter((s) => s.is_pinned)
  const rest = visible.filter((s) => !s.is_pinned)

  // start_at 오름차순으로 날짜별 그룹핑 (서버가 이미 정렬해서 내려줌)
  const groups: { key: string; label: string; items: Schedule[] }[] = []
  for (const s of rest) {
    const key = dateKey(new Date(s.start_at))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(s)
    else groups.push({ key, label: formatGroupDate(s.start_at), items: [s] })
  }

  function renderItem(s: Schedule, showDate = false) {
    return (
      <li
        key={s.id}
        onClick={() => onEdit(s)}
        onContextMenu={menu.onContextMenu(s)}
        data-tip="눌러서 일정을 고칩니다. 우클릭하면 완료·고정·삭제 메뉴가 뜹니다"
        className="flex cursor-pointer items-start gap-2 rounded-lg bg-white p-3 border border-slate-200/80 transition hover:bg-slate-50"
      >
        <input
          type="checkbox"
          checked={s.is_done}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleDone(s)}
          data-tip="체크하면 완료로 표시되고 줄이 그어집니다"
          className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
        />
        <div className="min-w-0 flex-1">
          <p
            className={`flex items-center gap-1.5 text-sm font-medium ${
              s.is_done ? 'text-slate-400 line-through' : 'text-slate-800'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${colorStyleOf(s.category_color).dot}`}
            />
            <span className="truncate">{s.title}</span>
            {s.repeat && (
              <span
                className="shrink-0 rounded bg-slate-100 px-1 text-[11px] font-normal text-slate-500"
                data-tip={s.repeat_until ? `${s.repeat_until}까지 반복` : '반복 일정'}
              >
                {repeatLabel(s.repeat, s.start_at, true)}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {showDate && (
              <span className="mr-1.5">{formatDate(s.start_at)}</span>
            )}
            {s.is_all_day
              ? '하루종일'
              : `${formatTime(s.start_at)}${
                  s.end_at ? ` ~ ${formatTime(s.end_at)}` : ''
                }`}
            <span className="ml-1.5 text-slate-400">{s.owner_username}</span>
          </p>
          {(s.category_name || s.description) && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              {s.category_name && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                  {s.category_name}
                </span>
              )}
              {s.description && <span className="truncate">{s.description}</span>}
            </p>
          )}
        </div>
        <span className="flex shrink-0 flex-col gap-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onTogglePin(s)
            }}
            data-tip={s.is_pinned ? '고정을 풀어 날짜 순서로 돌려놓습니다' : '목록 맨 위 고정됨 칸에 올려 둡니다'}
            aria-label={`${s.title} ${s.is_pinned ? '고정 해제' : '상단 고정'}`}
            className={`rounded-lg p-1.5 transition max-md:p-2.5 ${
              s.is_pinned
                ? 'text-amber-400 hover:bg-amber-50 hover:text-amber-500'
                : 'text-slate-300 hover:bg-slate-100 hover:text-amber-400'
            }`}
          >
            <StarIcon filled={s.is_pinned} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setPendingDelete(s)
            }}
            data-tip="이 일정을 삭제합니다. 되돌릴 수 없습니다"
            aria-label={`${s.title} 삭제`}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 max-md:p-2.5"
          >
            <TrashIcon />
          </button>
        </span>
      </li>
    )
  }

  return (
    <>
      {doneToggle}
      <div className="space-y-4">
        {pinned.length > 0 && (
          <section>
            <h3 className="sticky top-12 z-10 mb-1.5 md:top-0 flex items-center gap-1 bg-slate-100 py-1 text-xs font-semibold text-amber-500">
              <StarIcon filled />
              고정됨
            </h3>
            <ul className="space-y-1.5">
              {pinned.map((s) => renderItem(s, true))}
            </ul>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className="sticky top-12 z-10 mb-1.5 md:top-0 bg-slate-100 py-1 text-xs font-semibold text-slate-500">
              {g.label}
            </h3>
            <ul className="space-y-1.5">{g.items.map((s) => renderItem(s))}</ul>
          </section>
        ))}
      </div>

      {menu.element}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="일정 삭제"
        message={
          pendingDelete
            ? `'${pendingDelete.title}' 일정을 삭제할까요?\n삭제한 일정은 복구할 수 없습니다.`
            : ''
        }
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
