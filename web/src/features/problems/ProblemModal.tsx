import { shortRole } from '../../lib/roles'
import { useState, type FormEvent } from 'react'
import type {
  ProblemStatus,
  ProblemUnknown,
  ProcessNode,
  UserSummary,
} from '../../api'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import AutoTextarea from '../../components/ui/AutoTextarea'
import { PROBLEM_STATUS_META, PROBLEM_STATUS_ORDER } from '../../lib/labels'
import { type ProblemFormValues } from './problemFormValues'
import { buildTree, flatten, indentedLabel } from './processTree'

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'

interface Props {
  open: boolean
  editing: boolean
  values: ProblemFormValues
  users: UserSummary[]
  /** 회사 프로세스 단계 (프로세스 단계 고르기용) */
  processNodes: ProcessNode[]
  submitting: boolean
  onChange: (values: ProblemFormValues) => void
  onSubmit: () => void
  onClose: () => void
  onDelete?: () => void
}

export default function ProblemModal({
  open,
  editing,
  values,
  users,
  processNodes,
  submitting,
  onChange,
  onSubmit,
  onClose,
  onDelete,
}: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const processOptions = flatten(buildTree(processNodes))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSubmit()
  }

  function updateUnknown(index: number, patch: Partial<ProblemUnknown>) {
    onChange({
      ...values,
      unknowns: values.unknowns.map((u, i) =>
        i === index ? { ...u, ...patch } : u,
      ),
    })
  }

  /** 가장 위험한 가정은 하나만: 클릭한 항목만 켜고 나머지는 끈다. 다시 클릭하면 해제. */
  function toggleRiskiest(index: number) {
    onChange({
      ...values,
      unknowns: values.unknowns.map((u, i) => ({
        ...u,
        riskiest: i === index ? !u.riskiest : false,
      })),
    })
  }

  return (
    <>
      <Modal
        open={open}
        title={editing ? '문제 상세' : '새 문제'}
        onClose={onClose}
        widthClass="max-w-3xl"
      >
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <label className="block text-sm text-slate-600">
              문제의 정의
              <input
                type="text"
                value={values.definition}
                onChange={(e) =>
                  onChange({ ...values, definition: e.target.value })
                }
                required
                autoFocus
                placeholder="지금 무엇이 어떻게 막혀 있는지 한 문장으로"
                className={`mt-1 ${inputClass}`}
              />
            </label>

            <label className="block text-sm text-slate-600">
              풀지 않으면 어떻게 되는가
              <AutoTextarea
                value={values.impact}
                onChange={(e) => onChange({ ...values, impact: e.target.value })}
                placeholder="그대로 두면 막히는 것들"
                className={`mt-1 ${inputClass}`}
              />
            </label>

            {/* 모르는 부분 */}
            <div>
              <div className="mb-1.5 flex items-center gap-3 text-sm text-slate-600">
                모르는 부분
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...values,
                      unknowns: [...values.unknowns, { text: '', riskiest: false }],
                    })
                  }
                  data-tip="아직 모르는 내용이나 가정을 한 줄 더합니다. 가장 위험한 것 하나에 [위험]을 눌러 표시합니다"
                  className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
                >
                  + 더하기
                </button>
              </div>
              <div className="space-y-1.5">
                {values.unknowns.map((u, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleRiskiest(i)}
                      data-tip={
                        u.riskiest ? '가장 위험한 가정 표시를 풉니다' : '가장 위험한 가정으로 표시합니다. 카드에도 보입니다'
                      }
                      aria-label={`모르는 부분 ${i + 1} 위험 가정 ${u.riskiest ? '해제' : '표시'}`}
                      aria-pressed={u.riskiest}
                      className={`shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                        u.riskiest
                          ? 'bg-amber-100 text-amber-700'
                          : 'text-slate-400 hover:bg-slate-100 hover:text-amber-600'
                      }`}
                    >
                      위험
                    </button>
                    <input
                      type="text"
                      value={u.text}
                      placeholder="모르는 내용 / 가정"
                      onChange={(e) => updateUnknown(i, { text: e.target.value })}
                      className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none ${
                        u.riskiest
                          ? 'border-amber-300 bg-amber-50 focus:border-amber-500'
                          : 'border-slate-300 focus:border-blue-500'
                      }`}
                    />
                    <button
                      type="button"
                      aria-label={`모르는 부분 ${i + 1} 삭제`}
                      data-tip="이 줄을 뺍니다. 저장해야 반영됩니다"
                      onClick={() =>
                        onChange({
                          ...values,
                          unknowns: values.unknowns.filter((_, idx) => idx !== i),
                        })
                      }
                      className="shrink-0 rounded px-2 py-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <label className="block text-sm text-slate-600">
              끝나는 조건
              <AutoTextarea
                value={values.resolve_condition}
                onChange={(e) =>
                  onChange({ ...values, resolve_condition: e.target.value })
                }
                placeholder="어떻게 하면 문제가 없어지는가"
                className={`mt-1 ${inputClass}`}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-600">
                들일 시간
                <input
                  type="text"
                  value={values.time_budget}
                  placeholder="예: 2주 / 10시간"
                  onChange={(e) =>
                    onChange({ ...values, time_budget: e.target.value })
                  }
                  className={`mt-1 ${inputClass}`}
                />
              </label>
              <div className="text-sm text-slate-600">
                <label>
                  결정 기한
                  <input
                    type="date"
                    value={values.due_date}
                    data-tip="들일 시간이 끝나는 날입니다. 지나면 계속할지 멈출지 정하고, 목록에 '지남'으로 표시됩니다"
                    onChange={(e) =>
                      onChange({ ...values, due_date: e.target.value })
                    }
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
              </div>
              <div className="text-sm text-slate-600">
              <label>
                문제의 오너
                <select
                  value={values.assignee}
                  data-tip="이 문제를 책임지고 끝까지 볼 사람입니다"
                  onChange={(e) =>
                    onChange({
                      ...values,
                      assignee:
                        e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                  className={`mt-1 ${inputClass} bg-white`}
                >
                  <option value="">미지정</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id} title={u.role || undefined}>
                      {u.nickname || u.username}
                      {u.role ? ` · ${shortRole(u.role, 30)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
                {values.assignee === '' && values.status !== 'on_hold' && (
                  <p className="mt-1 text-xs text-amber-600">
                    오너를 정할 수 없으면 상태를 '보류'로 두세요
                  </p>
                )}
              </div>
              <label className="text-sm text-slate-600">
                상태
                <select
                  value={values.status}
                  data-tip="문제가 어디까지 왔는지 정합니다. 오너가 없으면 보류로"
                  onChange={(e) =>
                    onChange({
                      ...values,
                      status: e.target.value as ProblemStatus,
                    })
                  }
                  className={`mt-1 ${inputClass} bg-white`}
                >
                  {PROBLEM_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {PROBLEM_STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-600 sm:col-span-2">
                프로세스 단계
                <select
                  value={values.process}
                  data-tip="회사 일의 어느 단계에서 생긴 문제인지. 프로세스 맵에서 이 단계에 매달려 보입니다"
                  onChange={(e) =>
                    onChange({
                      ...values,
                      process: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                  className={`mt-1 ${inputClass} bg-white`}
                >
                  <option value="">프로세스 미지정</option>
                  {processOptions.map((n) => (
                    <option key={n.id} value={n.id}>
                      {indentedLabel(n)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(values.status === 'solved' || values.status === 'paused' || values.result) && (
              <label className="block text-sm text-slate-600">
                어떻게 풀었나
                <AutoTextarea
                  value={values.result}
                  onChange={(e) => onChange({ ...values, result: e.target.value })}
                  minRows={3}
                  placeholder="푼 방법이나 멈춘 이유. 같은 문제가 다시 나면 목록에서 찾아봅니다"
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            )}
          </div>

          <div className="mt-5 flex items-center gap-2">
            {editing && onDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-500 transition hover:bg-red-50"
              >
                삭제
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
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
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="문제 삭제"
        message={`'${values.definition}' 문제를 삭제할까요?`}
        onConfirm={() => {
          setConfirmDelete(false)
          onDelete?.()
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}
