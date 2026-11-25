import type { Schedule, ScheduleRepeat } from '../../api'
import { dateKey } from '../../lib/datetime'

/**
 * 반복 일정: 원본 하나만 저장하고 화면에서 발생분을 펼친다 (서버 apps/schedules/repeat.py 와 같은 규칙).
 * 매주는 시작일의 요일마다 7일 간격, 매월은 시작일과 같은 날(그 날이 없는 달은 건너뜀).
 * 여러 날 일정은 같은 길이로, repeat_until 이 있으면 그날까지 시작하는 것만.
 */

const WEEKDAYS = '일월화수목금토'

/** 'YYYY-MM-DD'(입력칸 값)는 로컬 자정으로, 그 밖(ISO·datetime-local)은 그대로 읽는다 */
function parse(v: string): Date | null {
  if (!v) return null
  const d = new Date(v.length === 10 ? `${v}T00:00` : v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** '매주 월요일'·'매월 15일' (short 면 '매주 월'·'매월 15일'). 시작이 비었으면 '매주'·'매월' */
export function repeatLabel(repeat: ScheduleRepeat | undefined, start: string, short = false): string {
  if (!repeat) return ''
  const d = parse(start)
  if (repeat === 'weekly') return d ? `매주 ${WEEKDAYS[d.getDay()]}${short ? '' : '요일'}` : '매주'
  return d ? `매월 ${d.getDate()}일` : '매월'
}

/** k 번째 발생 시작 (그 달에 그 날이 없으면 null) */
function nth(base: Date, repeat: ScheduleRepeat, k: number): Date | null {
  if (repeat === 'weekly') {
    const d = new Date(base)
    d.setDate(d.getDate() + 7 * k)
    return d
  }
  const d = new Date(base.getFullYear(), base.getMonth() + k, base.getDate(),
    base.getHours(), base.getMinutes(), base.getSeconds())
  return d.getDate() === base.getDate() ? d : null
}

/** 일정 s 의 [from, to) 와 겹치는 발생분. 반복이 아니면 s 그대로 하나. id 는 원본 그대로 */
function occurrences(s: Schedule, from: Date, to: Date): Schedule[] {
  if (!s.repeat) return [s]
  const base = new Date(s.start_at)
  const length = s.end_at ? new Date(s.end_at).getTime() - base.getTime() : null
  const out: Schedule[] = []
  for (let k = 0; k < 5000; k++) {
    const start = nth(base, s.repeat, k)
    if (!start) continue
    if (start >= to || (s.repeat_until && dateKey(start) > s.repeat_until)) break
    const end = length === null ? null : new Date(start.getTime() + length)
    if ((end ?? start) >= from) {
      out.push(k === 0 ? s : { ...s, start_at: start.toISOString(), end_at: end ? end.toISOString() : null })
    }
  }
  return out
}

/** 반복 일정을 [from, to) 의 발생분으로 펼친다 (반복 아닌 일정은 그대로 둔다) */
export function expandRepeats(list: Schedule[], from: Date, to: Date): Schedule[] {
  return list.flatMap((s) => occurrences(s, from, to))
}
