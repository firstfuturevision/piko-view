import { useEffect, useState } from 'react'
import { api, type DocSummary, type UserSummary } from '../../api'
import Modal from '../../components/Modal'
import { MultiUserPicker } from '../../components/UserPicker'
import { docPath, errorText, KIND_LABEL } from './docUtils'

interface Props {
  doc: DocSummary | null
  onClose: () => void
  /** 공유 대상이 바뀐 뒤 (새 요약을 넘긴다) */
  onChanged?: (doc: DocSummary) => void
}

/**
 * 공유: 개인 파일은 주인이 사람을 골라 함께 보고 고치게 한다.
 * 프로젝트 파일은 모든 사람이 보므로 링크만 복사한다.
 */
export default function ShareDialog(props: Props) {
  // 열 때마다 처음 상태로 (파일이 바뀌면 새로 만든다)
  return props.doc ? <ShareBody key={props.doc.id} {...props} doc={props.doc} /> : null
}

function ShareBody({ doc, onClose, onChanged }: Props & { doc: DocSummary }) {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [ids, setIds] = useState<number[]>(() => doc.shared_with_users.map((u) => u.id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .listUsers()
      .then((list) => alive && setUsers(list.filter((u) => u.id !== doc.owner)))
      .catch(() => alive && setError('사람 목록을 불러오지 못했습니다.'))
    return () => {
      alive = false
    }
  }, [doc])

  const label = KIND_LABEL[doc.kind]
  const personal = doc.project === null
  const link = `${location.origin}${docPath(doc)}`

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setError('링크를 복사하지 못했습니다. 주소창의 주소를 복사해 주세요.')
    }
  }

  async function save() {
    const before = doc.shared_with_users.map((u) => u.id)
    const add = ids.filter((i) => !before.includes(i))
    const remove = before.filter((i) => !ids.includes(i))
    setBusy(true)
    setError('')
    try {
      let next = doc
      if (add.length) next = await api.shareDoc(doc.id, add)
      if (remove.length) next = await api.unshareDoc(doc.id, remove)
      onChanged?.(next)
      onClose()
    } catch (e) {
      setError(errorText(e, '공유를 바꾸지 못했습니다.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={`'${doc.title}' 공유`} onClose={onClose} widthClass="max-w-md">
      <div className="space-y-4 text-sm text-slate-600">
        {personal ? (
          doc.can_manage ? (
            <>
              <MultiUserPicker
                label="함께 볼 사람"
                hint="고른 사람은 보고 고칠 수 있습니다"
                users={users}
                value={ids}
                onChange={setIds}
              />
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                🔒 내 파일은 나와 여기서 고른 사람만 봅니다.
              </p>
            </>
          ) : (
            <p className="rounded-lg bg-slate-50 px-3 py-2">
              {doc.owner_name || '만든 사람'} 님이 공유한 {label}입니다. 공유 대상은 만든 사람만 바꿀 수 있습니다.
            </p>
          )
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2">
            📁 &lsquo;{doc.project_name}&rsquo; 프로젝트의 {label}라 모든 사람이 보고 고칠 수 있습니다. 아래 링크를
            보내 주세요.
          </p>
        )}

        <div className="flex items-center gap-2">
          <input readOnly value={link} aria-label="링크" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500" />
          <button
            type="button"
            onClick={() => void copyLink()}
            data-tip="이 파일 주소를 복사합니다. 볼 수 있는 사람만 열 수 있습니다"
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50"
          >
            {copied ? '복사됨 ✓' : '링크 복사'}
          </button>
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50">
            {personal && doc.can_manage ? '취소' : '닫기'}
          </button>
          {personal && doc.can_manage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              저장
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
