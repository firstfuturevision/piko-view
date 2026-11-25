import { COLOR_KEYS, SCHEDULE_COLORS, type ScheduleColor } from '../lib/colors'

interface Props {
  value: ScheduleColor
  onChange: (color: ScheduleColor) => void
  /** 스와치 크기 (기본 h-6 w-6) */
  size?: string
}

export default function ColorPicker({ value, onChange, size = 'h-6 w-6' }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          data-tip={`${SCHEDULE_COLORS[key].label}으로 표시합니다`}
          aria-label={SCHEDULE_COLORS[key].label}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`${size} rounded-full transition ${SCHEDULE_COLORS[key].dot} ${
            value === key
              ? 'ring-2 ring-slate-400 ring-offset-1'
              : 'opacity-60 hover:opacity-100'
          }`}
        />
      ))}
    </div>
  )
}
