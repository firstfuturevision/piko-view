import { useState } from 'react'
import type { Category } from '../../api'
import type { ScheduleColor } from '../../lib/colors'
import ConfirmDialog from '../../components/ConfirmDialog'
import Modal from '../../components/Modal'
import ScheduleForm from './ScheduleForm'
import { type ScheduleFormValues } from './scheduleFormValues'

interface Props {
  open: boolean
  editing: boolean
  values: ScheduleFormValues
  categories: Category[]
  submitting: boolean
  onChange: (values: ScheduleFormValues) => void
  onCreateCategory: (name: string, color: ScheduleColor) => Promise<Category>
  onSubmit: () => void
  onClose: () => void
  /** 수정 모드에서 삭제 버튼 클릭 시 호출 (확인 다이얼로그 통과 후) */
  onDelete?: () => void
}

/** 일정 추가/수정 모달. 범용 UI는 Modal, 폼 로직은 ScheduleForm에 위임한다. */
export default function ScheduleModal({
  open,
  editing,
  values,
  categories,
  submitting,
  onChange,
  onCreateCategory,
  onSubmit,
  onClose,
  onDelete,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <Modal
        open={open}
        title={editing ? '일정 수정' : '새 일정 추가'}
        onClose={onClose}
        widthClass="max-w-xl"
      >
        <ScheduleForm
          values={values}
          categories={categories}
          editing={editing}
          submitting={submitting}
          onChange={onChange}
          onCreateCategory={onCreateCategory}
          onSubmit={onSubmit}
          onCancel={onClose}
          onDelete={
            editing && onDelete ? () => setConfirmOpen(true) : undefined
          }
        />
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="일정 삭제"
        message={`'${values.title}' 일정을 삭제할까요?\n삭제한 일정은 복구할 수 없습니다.`}
        onConfirm={() => {
          setConfirmOpen(false)
          onDelete?.()
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
