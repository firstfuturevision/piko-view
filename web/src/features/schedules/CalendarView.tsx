import { useMemo, useState } from 'react'
import Icon from '../../components/Icon'
import type { Schedule } from '../../api'
import { colorStyleOf } from '../../lib/colors'
import { dateKey, formatTime } from '../../lib/datetime'
import { expandRepeats } from './repeat'

interface Props {
  schedules: Schedule[]
  onSelectSchedule: (s: Schedule) => void
  onSelectDate: (date: Date) => void
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
/** 여러 날 띠 한 줄의 높이(px): 띠 20 + 간격 2 */
const BAR_H = 22
/** 날짜 숫자 영역 아래에서 띠가 시작되는 오프셋(px) */
const BAR_TOP = 34
/** 셀당 표시 항목(띠 줄 + 단일 일정 칩) 최대 수 */
const MAX_ROWS = 4

function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }
  // 마지막 주가 전부 다음 달이면 5주만 표시
  if (cells[35].getMonth() !== month) return cells.slice(0, 35)
  return cells
}

interface MultiDay {
  s: Schedule
  startKey: string
  endKey: string
}

interface BarSegment extends MultiDay {
  startCol: number
  endCol: number
  lane: number
  roundLeft: boolean
  roundRight: boolean
}

/** 한 주에 걸치는 여러 날 일정들을 겹치지 않게 lane에 배치한다. */
function buildWeekSegments(multi: MultiDay[], weekKeys: string[]): BarSegment[] {
  const segments = multi
    .filter((m) => m.startKey <= weekKeys[6] && m.endKey >= weekKeys[0])
    .map((m) => ({
      ...m,
      startCol: m.startKey <= weekKeys[0] ? 0 : weekKeys.indexOf(m.startKey),
      endCol: m.endKey >= weekKeys[6] ? 6 : weekKeys.indexOf(m.endKey),
      lane: 0,
      roundLeft: m.startKey >= weekKeys[0],
      roundRight: m.endKey <= weekKeys[6],
    }))
    .sort((a, b) => a.startCol - b.startCol || b.endCol - a.endCol)

  const lanes: BarSegment[][] = []
  for (const seg of segments) {
    let placed = false
    for (let i = 0; i < lanes.length; i++) {
      const collides = lanes[i].some(
        (o) => !(o.endCol < seg.startCol || o.startCol > seg.endCol),
      )
      if (!collides) {
        seg.lane = i
        lanes[i].push(seg)
        placed = true
        break
      }
    }
    if (!placed) {
      seg.lane = lanes.length
      lanes.push([seg])
    }
  }
  return segments
}

export default function CalendarView({
  schedules,
  onSelectSchedule,
  onSelectDate,
}: Props) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const cells = useMemo(() => buildMonthGrid(year, month), [year, month])

  // 하루짜리는 날짜별 맵으로, 여러 날 일정은 띠로 분리한다.
  // 반복 일정은 보이는 칸 범위의 발생분으로 펼친다 (누르면 원본을 고친다).
  const { singlesByDate, multiDay } = useMemo(() => {
    const singles = new Map<string, Schedule[]>()
    const multi: MultiDay[] = []
    const last = cells[cells.length - 1]
    const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
    for (const s of expandRepeats(schedules, cells[0], to)) {
      const start = new Date(s.start_at)
      const end = s.end_at ? new Date(s.end_at) : start
      const startKey = dateKey(start)
      const endKey = end < start ? startKey : dateKey(end)
      if (startKey === endKey) {
        const list = singles.get(startKey)
        if (list) list.push(s)
        else singles.set(startKey, [s])
      } else {
        multi.push({ s, startKey, endKey })
      }
    }
    multi.sort(
      (a, b) =>
        a.startKey.localeCompare(b.startKey) || b.endKey.localeCompare(a.endKey),
    )
    return { singlesByDate: singles, multiDay: multi }
  }, [schedules, cells])

  const weeks = useMemo(() => {
    const rows: Date[][] = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [cells])
  const todayKey = dateKey(today)

  function moveMonth(delta: number) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
  }

  function barClass(s: Schedule, seg: BarSegment): string {
    const rounding = `${seg.roundLeft ? 'rounded-l' : ''} ${seg.roundRight ? 'rounded-r' : ''}`
    if (s.is_done) return `${rounding} bg-slate-200 text-slate-400 line-through`
    return `${rounding} ${colorStyleOf(s.category_color).solid}`
  }

  return (
    <div className="flex h-full flex-col rounded-xl bg-white p-4 border border-slate-200/80">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">
          {year}년 {month + 1}월
        </h2>
        <div className="flex gap-1 text-sm">
          <button
            onClick={() => moveMonth(-1)}
            aria-label="이전 달"
            data-tip="이전 달로 갑니다"
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          >
            <Icon name="chevronLeft" className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            data-tip="이번 달로 돌아옵니다"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 transition hover:bg-slate-50"
          >
            오늘
          </button>
          <button
            onClick={() => moveMonth(1)}
            aria-label="다음 달"
            data-tip="다음 달로 갑니다"
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          >
            <Icon name="chevronRight" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-500">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-2 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : ''}`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 남는 화면 높이를 주 단위로 균등 분배. 셀 min-h가 하한. */}
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-hidden rounded-lg bg-slate-200">
        {weeks.map((week) => {
          const weekKeys = week.map(dateKey)
          const segments = buildWeekSegments(multiDay, weekKeys)

          return (
            <div
              key={weekKeys[0]}
              className="relative grid flex-1 grid-cols-7 gap-px"
            >
              {week.map((d, col) => {
                const key = weekKeys[col]
                const inMonth = d.getMonth() === month
                const isToday = key === todayKey
                const items = singlesByDate.get(key) ?? []
                // 이 칸 위를 실제로 지나가는 띠의 가장 아래 lane까지만 공간을 확보한다.
                // 띠가 걸치지 않은 날은 단일 일정이 밀리지 않고 맨 위부터 표시된다.
                const lanesHere = segments.reduce(
                  (m, seg) =>
                    seg.startCol <= col && col <= seg.endCol
                      ? Math.max(m, seg.lane + 1)
                      : m,
                  0,
                )
                const maxSingles = Math.max(0, MAX_ROWS - lanesHere)
                const hidden = Math.max(0, items.length - maxSingles)
                return (
                  <div
                    key={key}
                    onClick={() => onSelectDate(d)}
                    className={`min-h-32 cursor-pointer bg-white p-1.5 transition hover:bg-slate-50 ${
                      inMonth ? '' : 'bg-slate-50 text-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                        isToday
                          ? 'bg-blue-600 font-bold text-white'
                          : d.getDay() === 0 && inMonth
                            ? 'text-red-500'
                            : d.getDay() === 6 && inMonth
                              ? 'text-blue-500'
                              : ''
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    {/* 띠가 지나가는 영역 확보 */}
                    {lanesHere > 0 && (
                      <div style={{ height: lanesHere * BAR_H }} aria-hidden />
                    )}
                    <div className="mt-0.5 space-y-0.5">
                      {items.slice(0, maxSingles).map((s) => (
                        <button
                          key={s.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectSchedule(s)
                          }}
                          data-tip={
                            (s.is_all_day
                              ? `하루종일 ${s.title}`
                              : `${formatTime(s.start_at)} ${s.title}`) +
                            ` (${s.owner_username})` +
                            (s.id < 0 ? ` · ${s.virtual_label ?? '태스크'}` : '')
                          }
                          className={`block w-full truncate rounded px-1 py-0.5 text-left text-xs transition ${
                            s.is_done
                              ? 'bg-slate-100 text-slate-400 line-through'
                              : s.is_all_day
                                ? colorStyleOf(s.category_color).solid
                                : colorStyleOf(s.category_color).soft
                          }`}
                        >
                          {s.title}
                        </button>
                      ))}
                      {hidden > 0 && (
                        <p className="px-1 text-xs text-slate-400">
                          +{hidden}개 더
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* 여러 날 일정 띠 (주 단위 절대 배치) */}
              {segments.map((seg) => (
                <button
                  key={`${seg.s.id}-${seg.startCol}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectSchedule(seg.s)
                  }}
                  data-tip={`${seg.s.title} (${seg.s.owner_username})${seg.s.id < 0 ? ` · ${seg.s.virtual_label ?? '태스크'}` : ''}`}
                  style={{
                    top: BAR_TOP + seg.lane * BAR_H,
                    left: `calc(${(seg.startCol / 7) * 100}% + 2px)`,
                    width: `calc(${((seg.endCol - seg.startCol + 1) / 7) * 100}% - 4px)`,
                  }}
                  className={`absolute h-5 truncate px-1.5 text-left text-xs leading-5 transition ${barClass(seg.s, seg)}`}
                >
                  {seg.s.title}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
