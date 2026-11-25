import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api, type FileComment } from '../../../api'
import ConfirmDialog from '../../../components/ConfirmDialog'
import { cursorColor, type CollabSession } from '../../../lib/collab'
import { errorText, timeAgo } from '../docUtils'
import { commentRanges, draftKey, markOf, removeCommentMark } from './commentMark'
import DocIcon from './icons'

// 오른쪽 여백의 댓글 카드 (구글 문서처럼 댓글 단 글 높이에 맞춰 놓인다).
// 댓글 자리는 문서 안의 comment 표시(mark)로 정해지고, 내용·답글·해결은 REST 로 저장한다.
// 누가 댓글을 바꾸면 서버가 공동 편집 방에 알리고(onComments) 목록을 다시 불러온다.

const GAP = 10

function newMarkId(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return `c${rnd.replace(/[^a-z0-9]/gi, '').slice(0, 15)}`
}

/** 이 댓글 표시가 있는 글을 고른다 (카드를 눌렀을 때) */
function selectMark(editor: Editor, markId: string, scroll: boolean) {
  const range = commentRanges(editor.state.doc).get(markId)
  if (!range) return
  editor.commands.setTextSelection({ from: range.from, to: range.to })
  if (scroll) {
    const el = editor.view.dom.querySelector(`[data-comment-id="${markId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: cursorColor(name || '?') }}
      aria-hidden
    >
      {(name || '?').slice(0, 1)}
    </span>
  )
}

function TextBox({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  submitLabel,
  autoFocus,
  busy,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel?: () => void
  placeholder: string
  submitLabel: string
  autoFocus?: boolean
  busy?: boolean
}) {
  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            onSubmit()
          } else if (e.key === 'Escape' && onCancel) {
            e.preventDefault()
            onCancel()
          }
        }}
        rows={2}
        placeholder={placeholder}
        className="block w-full resize-none rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px] leading-relaxed focus:border-blue-500 focus:outline-none"
      />
      {(value.trim() || onCancel) && (
        <div className="mt-1.5 flex justify-end gap-1.5">
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100">
              취소
            </button>
          )}
          <button
            type="button"
            disabled={!value.trim() || busy}
            onClick={onSubmit}
            data-tip="Ctrl+Enter 로도 보냅니다"
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  )
}

interface Props {
  editor: Editor
  docId: number
  session: CollabSession
  /** 카드 위치 기준 (오른쪽 댓글 칸) */
  readOnly: boolean
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  /** 열린 댓글 수가 바뀌면 (위쪽 막대 표시용) */
  onCount: (open: number) => void
}

export default function CommentsPanel({ editor, docId, session, readOnly, historyOpen, onHistoryOpenChange, onCount }: Props) {
  const [comments, setComments] = useState<FileComment[]>([])
  const [active, setActive] = useState<string>('')
  const [draftText, setDraftText] = useState('')
  const [replyText, setReplyText] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null)
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<FileComment | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const columnRef = useRef<HTMLDivElement>(null)

  const reload = useCallback(() => {
    api
      .listComments('doc', docId)
      .then(setComments)
      .catch((e) => setError(errorText(e, '댓글을 불러오지 못했습니다.')))
  }, [docId])

  useEffect(() => {
    reload()
    return session.onComments(() => reload())
  }, [reload, session])

  // 문서 안에 있는 댓글 표시들과 쓰는 중인 댓글 자리
  const { markIds, draft } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      markIds: [...commentRanges(e.state.doc).keys()].sort().join(' '),
      draft: draftKey.getState(e.state) ?? null,
    }),
  })
  const present = useMemo(() => new Set(markIds.split(' ').filter(Boolean)), [markIds])

  const roots = useMemo(() => comments.filter((c) => c.parent === null), [comments])
  const replies = useMemo(() => {
    const map = new Map<number, FileComment[]>()
    for (const c of comments) if (c.parent !== null) map.set(c.parent, [...(map.get(c.parent) ?? []), c])
    return map
  }, [comments])
  // 여백에 보일 카드: 해결되지 않았고, 본문에 자리가 남아 있는 댓글
  const visible = useMemo(() => roots.filter((c) => !c.resolved && present.has(markOf(c))), [roots, present])

  useEffect(() => {
    onCount(visible.length)
  }, [visible.length, onCount])

  // 본문 글자를 누르면 그 글의 댓글 카드를 앞으로
  useEffect(() => {
    const onSelect = () => {
      const { $from } = editor.state.selection
      const marks = [...$from.marks(), ...($from.nodeAfter?.marks ?? [])]
      const ids = marks.filter((m) => m.type.name === 'comment').map((m) => String(m.attrs.id))
      const hit = ids.find((id) => visible.some((c) => markOf(c) === id))
      if (hit) setActive(hit)
    }
    editor.on('selectionUpdate', onSelect)
    return () => {
      editor.off('selectionUpdate', onSelect)
    }
  }, [editor, visible])

  // ---------------------------------------------------------------- 카드 자리 잡기
  // 댓글 단 글의 높이에 카드를 두고, 겹치면 아래로 민다. 고른 카드는 제자리에 두고 위쪽 카드를 올린다.
  const relayout = useCallback(() => {
    const column = columnRef.current
    if (!column || editor.isDestroyed) return
    const base = column.getBoundingClientRect().top
    const items: { key: string; anchor: number; el: HTMLDivElement }[] = []
    for (const el of column.querySelectorAll<HTMLDivElement>(':scope > [data-card-key]')) {
      const key = el.dataset.cardKey ?? ''
      let anchor: number | null = null
      if (key === 'draft') {
        const d = draftKey.getState(editor.state)
        if (d) {
          try {
            anchor = editor.view.coordsAtPos(d.from).top - base
          } catch {
            anchor = null
          }
        }
      } else {
        const target = editor.view.dom.querySelector(`[data-comment-id="${key}"]`)
        if (target) anchor = target.getBoundingClientRect().top - base
      }
      if (anchor === null) {
        el.style.visibility = 'hidden'
        continue
      }
      el.style.visibility = ''
      items.push({ key, anchor: anchor - 6, el })
    }
    items.sort((a, b) => a.anchor - b.anchor)
    const tops = items.map((i) => i.anchor)
    const heights = items.map((i) => i.el.offsetHeight)
    const pin = items.findIndex((i) => i.key === (draft ? 'draft' : active))
    if (pin >= 0) {
      for (let i = pin - 1; i >= 0; i--) tops[i] = Math.min(tops[i], tops[i + 1] - heights[i] - GAP)
      for (let i = pin + 1; i < items.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + heights[i - 1] + GAP)
    } else {
      for (let i = 1; i < items.length; i++) tops[i] = Math.max(tops[i], tops[i - 1] + heights[i - 1] + GAP)
    }
    items.forEach((it, i) => {
      it.el.style.transform = `translateY(${Math.round(tops[i])}px)`
    })
  }, [editor, active, draft])

  useLayoutEffect(() => {
    relayout()
  })

  useEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(relayout)
    }
    editor.on('update', schedule)
    window.addEventListener('resize', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(editor.view.dom)
    // 이미지가 늦게 불러와져 높이가 바뀌는 경우
    editor.view.dom.addEventListener('load', schedule, true)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('update', schedule)
      window.removeEventListener('resize', schedule)
      ro.disconnect()
      editor.view.dom.removeEventListener('load', schedule, true)
    }
  }, [editor, relayout])

  // ---------------------------------------------------------------- 고치기

  async function job(fn: () => Promise<unknown>, fail: string) {
    setBusy(true)
    setError('')
    try {
      await fn()
      reload()
      return true
    } catch (e) {
      setError(errorText(e, fail))
      return false
    } finally {
      setBusy(false)
    }
  }

  function cancelDraft() {
    setDraftText('')
    editor.view.dispatch(editor.state.tr.setMeta(draftKey, null))
  }

  async function submitDraft() {
    const d = draftKey.getState(editor.state)
    const body = draftText.trim()
    if (!d || !body) return
    const id = newMarkId()
    const quote = editor.state.doc.textBetween(d.from, d.to, ' ').slice(0, 200)
    // 표시를 먼저 달아 두어야 다른 사람 화면에서도 바로 자리가 잡힌다
    const mark = editor.schema.marks.comment.create({ id })
    editor.view.dispatch(editor.state.tr.addMark(d.from, d.to, mark).setMeta(draftKey, null))
    setDraftText('')
    setActive(id)
    const ok = await job(
      () => api.createComment({ target_kind: 'doc', target_id: docId, body, anchor: { mark: id, quote } }),
      '댓글을 남기지 못했습니다.',
    )
    if (!ok) {
      editor.view.dispatch(removeCommentMark(editor.state, id))
      setDraftText(body)
    }
  }

  async function reply(root: FileComment) {
    const key = markOf(root)
    const body = (replyText[key] ?? '').trim()
    if (!body) return
    const ok = await job(
      () => api.createComment({ target_kind: 'doc', target_id: docId, body, parent: root.id, anchor: root.anchor }),
      '답글을 남기지 못했습니다.',
    )
    if (ok) setReplyText((r) => ({ ...r, [key]: '' }))
  }

  async function saveEdit() {
    if (!editing || !editing.text.trim()) return
    const ok = await job(() => api.updateComment(editing.id, { body: editing.text.trim() }), '댓글을 고치지 못했습니다.')
    if (ok) setEditing(null)
  }

  async function remove(c: FileComment) {
    const ok = await job(() => api.deleteComment(c.id), '댓글을 삭제하지 못했습니다.')
    if (ok && c.parent === null) {
      const id = markOf(c)
      if (id) editor.view.dispatch(removeCommentMark(editor.state, id))
    }
  }

  async function resolve(c: FileComment, resolved: boolean) {
    await job(() => (resolved ? api.resolveComment(c.id) : api.reopenComment(c.id)), '바꾸지 못했습니다.')
    if (resolved && markOf(c) === active) setActive('')
  }

  function activate(c: FileComment) {
    const id = markOf(c)
    setActive(id)
    selectMark(editor, id, false)
  }

  // ---------------------------------------------------------------- 그리기

  const body = (c: FileComment, small = false): ReactNode =>
    editing?.id === c.id ? (
      <TextBox
        autoFocus
        value={editing.text}
        onChange={(text) => setEditing({ id: c.id, text })}
        onSubmit={() => void saveEdit()}
        onCancel={() => setEditing(null)}
        placeholder="내용"
        submitLabel="저장"
        busy={busy}
      />
    ) : (
      <p className={`mt-1 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-slate-700 ${small ? '' : ''}`}>{c.body}</p>
    )

  const head = (c: FileComment, root: boolean): ReactNode => (
    <div className="flex items-center gap-2">
      <Avatar name={c.author_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-slate-800">{c.author_name || '이름 없음'}</p>
        <p className="text-[11px] text-slate-400" title={new Date(c.created_at).toLocaleString('ko-KR')}>
          {timeAgo(c.created_at)}
          {c.updated_at !== c.created_at && c.body && ' · 고침'}
        </p>
      </div>
      {root && !readOnly && (
        <button
          type="button"
          aria-label="해결"
          data-tip="해결: 댓글을 닫고 숨깁니다 (위쪽 '댓글 기록'에서 다시 열 수 있음)"
          onClick={(e) => {
            e.stopPropagation()
            void resolve(c, true)
          }}
          className="grid h-7 w-7 place-items-center rounded-full text-blue-600 transition hover:bg-blue-50"
        >
          <DocIcon name="check" />
        </button>
      )}
      {c.is_mine && !readOnly && (
        <div className="relative">
          <button
            type="button"
            aria-label="댓글 메뉴"
            data-tip="고치기·삭제"
            onClick={(e) => {
              e.stopPropagation()
              setMenuFor(menuFor === c.id ? null : c.id)
            }}
            className="grid h-7 w-7 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <DocIcon name="more" />
          </button>
          {menuFor === c.id && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="absolute top-full right-0 z-30 mt-1 w-28 rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-900/10"
            >
              <button
                type="button"
                onClick={() => {
                  setMenuFor(null)
                  setEditing({ id: c.id, text: c.body })
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
              >
                고치기
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuFor(null)
                  setPendingDelete(c)
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-slate-100"
              >
                삭제
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const css = useMemo(() => {
    const ids = visible.map(markOf).filter(Boolean)
    const sel = (id: string) => `.doc-page [data-comment-id="${id}"]`
    return [
      ids.length ? `${ids.map(sel).join(',')}{background:rgb(250 204 21 / .28);border-bottom:2px solid rgb(234 179 8 / .55)}` : '',
      active && ids.includes(active) ? `${sel(active)}{background:rgb(250 204 21 / .55)}` : '',
    ].join('\n')
  }, [visible, active])

  const resolvedCount = roots.filter((c) => c.resolved).length
  const orphanCount = roots.filter((c) => !c.resolved && !present.has(markOf(c))).length

  return (
    <div ref={columnRef} className="relative h-full w-full" onClick={() => setMenuFor(null)}>
      <style>{css}</style>
      {error && (
        <p role="alert" className="sticky top-2 z-30 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 shadow-sm">
          {error}
          <button type="button" onClick={() => setError('')} className="ml-2 text-red-400 hover:text-red-700">
            ✕
          </button>
        </p>
      )}

      {draft && (
        <div
          data-card-key="draft"
          className="absolute top-0 right-0 left-0 z-20 rounded-xl bg-white p-3 shadow-lg ring-1 ring-blue-200 transition-transform duration-150"
        >
          <p className="text-[12px] font-semibold text-slate-500">새 댓글</p>
          <TextBox
            autoFocus
            value={draftText}
            onChange={setDraftText}
            onSubmit={() => void submitDraft()}
            onCancel={cancelDraft}
            placeholder="댓글을 입력하세요. 고른 글에 붙습니다"
            submitLabel="댓글"
            busy={busy}
          />
        </div>
      )}

      {visible.map((c) => {
        const key = markOf(c)
        const isActive = active === key && !draft
        const rs = replies.get(c.id) ?? []
        return (
          <div
            key={c.id}
            data-card-key={key}
            onClick={() => activate(c)}
            className={`absolute top-0 right-0 left-0 cursor-pointer rounded-xl bg-white p-3 transition-[transform,box-shadow] duration-150 ${
              isActive ? 'z-10 shadow-lg ring-1 ring-slate-300 -translate-x-2' : 'shadow-sm ring-1 ring-slate-200 hover:shadow-md'
            }`}
          >
            {head(c, true)}
            {body(c)}
            {rs.length > 0 && (
              <div className="mt-2 space-y-2.5 border-t border-slate-100 pt-2.5">
                {(isActive ? rs : rs.slice(-1)).map((r) => (
                  <div key={r.id}>
                    {head(r, false)}
                    {body(r, true)}
                  </div>
                ))}
                {!isActive && rs.length > 1 && <p className="text-[11px] text-blue-600">답글 {rs.length}개 · 눌러서 모두 보기</p>}
              </div>
            )}
            {isActive && !readOnly && (
              <TextBox
                value={replyText[key] ?? ''}
                onChange={(v) => setReplyText((r) => ({ ...r, [key]: v }))}
                onSubmit={() => void reply(c)}
                placeholder="답글 달기"
                submitLabel="답글"
                busy={busy}
              />
            )}
          </div>
        )
      })}

      {historyOpen &&
        createPortal(
          <CommentHistory
            roots={roots}
            replies={replies}
            present={present}
            onClose={() => onHistoryOpenChange(false)}
            onReopen={(c) => void resolve(c, false)}
            onShow={(c) => {
              onHistoryOpenChange(false)
              setActive(markOf(c))
              selectMark(editor, markOf(c), true)
            }}
            resolvedCount={resolvedCount}
            orphanCount={orphanCount}
            readOnly={readOnly}
          />,
          document.body,
        )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="댓글 삭제"
        message={
          pendingDelete?.parent === null
            ? '이 댓글을 삭제할까요? 달린 답글도 함께 지워집니다.'
            : '이 답글을 삭제할까요?'
        }
                onConfirm={() => {
          const c = pendingDelete
          setPendingDelete(null)
          if (c) void remove(c)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

/** 댓글 기록: 해결된 댓글과 본문이 지워진 댓글까지 모두 */
function CommentHistory({
  roots,
  replies,
  present,
  onClose,
  onReopen,
  onShow,
  resolvedCount,
  orphanCount,
  readOnly,
}: {
  roots: FileComment[]
  replies: Map<number, FileComment[]>
  present: Set<string>
  onClose: () => void
  onReopen: (c: FileComment) => void
  onShow: (c: FileComment) => void
  resolvedCount: number
  orphanCount: number
  readOnly: boolean
}) {
  const [showResolved, setShowResolved] = useState(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const list = [...roots]
    .filter((c) => showResolved || !c.resolved)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  return (
    <div className="fixed inset-0 z-50 flex justify-end print:hidden">
      <button type="button" aria-label="댓글 기록 닫기" onClick={onClose} className="absolute inset-0 bg-slate-900/20" />
      <aside role="dialog" aria-label="댓글 기록" className="relative flex h-full w-full max-w-sm flex-col bg-white shadow-2xl">
        <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-900">댓글 기록</h2>
            <p className="text-xs text-slate-500">
              모두 {roots.length}개 · 해결됨 {resolvedCount}개{orphanCount ? ` · 본문이 지워짐 ${orphanCount}개` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </header>
        <label className="flex items-center gap-2 border-b border-slate-100 px-5 py-2 text-sm text-slate-600">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          해결된 댓글도 보기
        </label>
        <ul className="flex-1 space-y-3 overflow-y-auto p-4">
          {list.length === 0 && <li className="py-10 text-center text-sm text-slate-400">댓글이 없습니다.</li>}
          {list.map((c) => {
            const anchored = present.has(markOf(c))
            const rs = replies.get(c.id) ?? []
            const quote = typeof c.anchor?.quote === 'string' ? c.anchor.quote : ''
            return (
              <li key={c.id} className={`rounded-xl p-3 ring-1 ${c.resolved ? 'bg-slate-50 ring-slate-200' : 'bg-white ring-slate-200'}`}>
                {quote && (
                  <p className="mb-2 truncate border-l-2 border-amber-300 pl-2 text-xs text-slate-500" title={quote}>
                    {quote}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Avatar name={c.author_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-slate-800">{c.author_name}</p>
                    <p className="text-[11px] text-slate-400">{timeAgo(c.created_at)}</p>
                  </div>
                  {c.resolved ? (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">해결됨</span>
                  ) : !anchored ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">본문이 지워짐</span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[13px] whitespace-pre-wrap text-slate-700">{c.body}</p>
                {rs.length > 0 && <p className="mt-1 text-[11px] text-slate-400">답글 {rs.length}개</p>}
                {c.resolved && c.resolved_by_name && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {c.resolved_by_name} 님이 해결 · {c.resolved_at ? timeAgo(c.resolved_at) : ''}
                  </p>
                )}
                <div className="mt-2 flex gap-1.5">
                  {c.resolved && !readOnly && (
                    <button
                      type="button"
                      onClick={() => onReopen(c)}
                      data-tip="다시 열어 여백에 카드를 보입니다"
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-white"
                    >
                      다시 열기
                    </button>
                  )}
                  {!c.resolved && anchored && (
                    <button
                      type="button"
                      onClick={() => onShow(c)}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      본문에서 보기
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </aside>
    </div>
  )
}
