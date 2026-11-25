export type ScheduleColor =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'navy'
  | 'purple'
  | 'black'

interface ColorStyle {
  label: string
  /** 진한 배경 (캘린더 하루종일 칩, 색상 선택 스와치) */
  solid: string
  /** 연한 배경 (캘린더 시간 일정 칩) */
  soft: string
  /** 작은 색상 점 */
  dot: string
}

export const SCHEDULE_COLORS: Record<ScheduleColor, ColorStyle> = {
  red: {
    label: '빨강',
    solid: 'bg-red-500 text-white hover:bg-red-600',
    soft: 'bg-red-100 text-red-700 hover:bg-red-200',
    dot: 'bg-red-500',
  },
  orange: {
    label: '주황',
    solid: 'bg-orange-500 text-white hover:bg-orange-600',
    soft: 'bg-orange-100 text-orange-700 hover:bg-orange-200',
    dot: 'bg-orange-500',
  },
  yellow: {
    label: '노랑',
    solid: 'bg-yellow-400 text-yellow-950 hover:bg-yellow-500',
    soft: 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200',
    dot: 'bg-yellow-400',
  },
  green: {
    label: '초록',
    solid: 'bg-green-600 text-white hover:bg-green-700',
    soft: 'bg-green-100 text-green-700 hover:bg-green-200',
    dot: 'bg-green-600',
  },
  blue: {
    label: '파랑',
    solid: 'bg-blue-500 text-white hover:bg-blue-600',
    soft: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
    dot: 'bg-blue-500',
  },
  navy: {
    label: '남색',
    solid: 'bg-indigo-900 text-white hover:bg-indigo-800',
    soft: 'bg-indigo-100 text-indigo-900 hover:bg-indigo-200',
    dot: 'bg-indigo-900',
  },
  purple: {
    label: '보라',
    solid: 'bg-purple-500 text-white hover:bg-purple-600',
    soft: 'bg-purple-100 text-purple-700 hover:bg-purple-200',
    dot: 'bg-purple-500',
  },
  black: {
    label: '검정',
    solid: 'bg-slate-900 text-white hover:bg-slate-800',
    soft: 'bg-slate-200 text-slate-800 hover:bg-slate-300',
    dot: 'bg-slate-900',
  },
}

export const COLOR_KEYS = Object.keys(SCHEDULE_COLORS) as ScheduleColor[]

export const DEFAULT_COLOR: ScheduleColor = 'blue'

/** 카테고리 미지정 일정의 표시 색 (밝은 회색) */
export const UNCATEGORIZED_STYLE: ColorStyle = {
  label: '미분류',
  solid: 'bg-slate-300 text-slate-700 hover:bg-slate-400',
  soft: 'bg-slate-100 text-slate-500 hover:bg-slate-200',
  dot: 'bg-slate-300',
}

/** 일정의 카테고리 색 → 스타일. 카테고리가 없으면 회색. */
export function colorStyleOf(
  color: ScheduleColor | null | undefined,
): ColorStyle {
  return color ? SCHEDULE_COLORS[color] : UNCATEGORIZED_STYLE
}
