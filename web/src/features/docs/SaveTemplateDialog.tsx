import { useState } from 'react'
import { api, type DocSummary } from '../../api'
import Modal from '../../components/Modal'
import { errorText, KIND_LABEL } from './docUtils'

interface Props {
  doc: Pick<DocSummary, 'id' | 'kind' | 'title'> | null
  onClose: () => void
  /** 템플릿으로 저장하기 전에 할 일 (편집기: 지금 내용을 먼저 서버에 보낸다) */
  beforeSave?: () => Promise<void>
  onSaved?: (name: string) => void
}

/** 지금 내용을 템플릿으로 저장: 새로 만들 때 템플릿 목록에 보인다 (모두가 함께 쓴다) */
export default function SaveTemplateDialog(props: Props) {
  return props.doc ? <SaveBody key={props.doc.id} {...props} doc={props.doc} /> : null
}

function SaveBody({ doc, onClose, beforeSave, onSaved }: Props & { doc: NonNullable<Props['doc']> }) {
  const [name, setName] = useState(doc.title)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      await beforeSave?.()
      await api.saveDocAsTemplate(doc.id, { name: name.trim(), description: description.trim() })
      onSaved?.(name.trim())
      onClose()
    } catch (e) {
      setError(errorText(e, '템플릿으로 저장하지 못했습니다.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="템플릿으로 저장" onClose={onClose} widthClass="max-w-md">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="space-y-3 text-sm text-slate-600"
      >
        <p className="text-slate-500">
          지금 {KIND_LABEL[doc.kind]} 내용을 틀로 저장합니다. &lsquo;새 {KIND_LABEL[doc.kind]}&rsquo;를 만들 때 모든 사람이
          고를 수 있습니다.
        </p>
        <label className="block">
          <span className="font-medium text-slate-700">템플릿 이름</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="font-medium text-slate-700">설명 (선택)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            placeholder="예: 고객 미팅 때 쓰는 회의록"
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50">
            취소
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
