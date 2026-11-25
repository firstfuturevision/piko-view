import type { ScheduleRepeat } from '../../api'

export interface ScheduleFormValues {
  title: string
  description: string
  /** all_day면 YYYY-MM-DD, 아니면 YYYY-MM-DDTHH:mm */
  start_at: string
  end_at: string
  all_day: boolean
  category: number | null
  repeat: ScheduleRepeat
  /** 반복이 끝나는 날 YYYY-MM-DD ('' 이면 계속) */
  repeat_until: string
}

export const emptyFormValues: ScheduleFormValues = {
  title: '',
  description: '',
  start_at: '',
  end_at: '',
  all_day: false,
  category: null,
  repeat: '',
  repeat_until: '',
}
