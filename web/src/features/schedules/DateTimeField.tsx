const MINUTE_STEP = 5

interface Props {
  label: string
  /** allDay면 YYYY-MM-DD, 아니면 YYYY-MM-DDTHH:mm (빈 문자열 허용) */
  value: string
  allDay: boolean
  required?: boolean
  onChange: (value: string) => void
}

function parse(value: string) {
  const date = value.slice(0, 10)
  const time = value.length >= 16 ? value.slice(11, 16) : ''
  return { date, time }
}

const selectClass =
  'rounded-lg border border-slate-300 bg-white px-2 py-2 focus:border-blue-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400'

export default function DateTimeField({
  label,
  value,
  allDay,
  required,
  onChange,
}: Props) {
  const { date, time } = parse(value)

  const hour24 = time ? Number(time.slice(0, 2)) : 9
  const minute = time ? Number(time.slice(3, 5)) : 0
  const isPM = hour24 >= 12
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12

  const minuteOptions = Array.from(
    { length: 60 / MINUTE_STEP },
    (_, i) => i * MINUTE_STEP,
  )
  // 5분 단위가 아닌 기존 값(예: 37분)도 선택 상태를 유지할 수 있게 포함
  if (!minuteOptions.includes(minute)) {
    minuteOptions.push(minute)
    minuteOptions.sort((a, b) => a - b)
  }

  function compose(d: string, h24: number, min: number): string {
    if (!d) return ''
    if (allDay) return d
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d}T${pad(h24)}:${pad(min)}`
  }

  function handleDateChange(newDate: string) {
    onChange(newDate ? compose(newDate, hour24, minute) : '')
  }

  function handleTimeChange(pm: boolean, h12: number, min: number) {
    const h24 = (h12 % 12) + (pm ? 12 : 0)
    onChange(compose(date, h24, min))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-sm text-slate-600">{label}</span>
      <input
        type="date"
        value={date}
        required={required}
        onChange={(e) => handleDateChange(e.target.value)}
        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
      />
      {!allDay && (
        <div className="flex items-center gap-1">
          <select
            value={isPM ? 'PM' : 'AM'}
            disabled={!date}
            onChange={(e) =>
              handleTimeChange(e.target.value === 'PM', hour12, minute)
            }
            className={selectClass}
          >
            <option value="AM">오전</option>
            <option value="PM">오후</option>
          </select>
          <select
            value={hour12}
            disabled={!date}
            onChange={(e) =>
              handleTimeChange(isPM, Number(e.target.value), minute)
            }
            className={selectClass}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <span className="text-sm text-slate-500">시</span>
          <select
            value={minute}
            disabled={!date}
            onChange={(e) =>
              handleTimeChange(isPM, hour12, Number(e.target.value))
            }
            className={selectClass}
          >
            {minuteOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="text-sm text-slate-500">분</span>
        </div>
      )}
    </div>
  )
}
