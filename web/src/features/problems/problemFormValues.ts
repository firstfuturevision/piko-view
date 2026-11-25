import type { ProblemInput, ProblemStatus, ProblemUnknown } from '../../api'

export interface ProblemFormValues {
  definition: string
  impact: string
  resolve_condition: string
  result: string
  time_budget: string
  due_date: string
  status: ProblemStatus
  unknowns: ProblemUnknown[]
  assignee: number | ''
  /** 회사 프로세스 단계 (ProcessNode id). '' 이면 미지정 */
  process: number | ''
}

export const emptyProblemValues: ProblemFormValues = {
  definition: '',
  impact: '',
  resolve_condition: '',
  result: '',
  time_budget: '',
  due_date: '',
  status: 'open',
  unknowns: [],
  assignee: '',
  process: '',
}

export function toProblemInput(values: ProblemFormValues): ProblemInput {
  return {
    definition: values.definition,
    impact: values.impact,
    resolve_condition: values.resolve_condition,
    result: values.result,
    time_budget: values.time_budget,
    due_date: values.due_date || null,
    status: values.status,
    unknowns: values.unknowns.filter((u) => u.text.trim()),
    assignee: values.assignee === '' ? null : values.assignee,
    process: values.process === '' ? null : values.process,
  }
}
