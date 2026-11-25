import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, type DocDetail, type DocSummary } from '../api'
import { API_BASE, csrfHeader } from '../api/client'
import { docPath, errorText } from '../features/docs/docUtils'
import CommentsPanel from '../features/docs/editor/CommentsPanel'
import { startCommentDraft } from '../features/docs/editor/commentMark'
import { DocShortcuts, SHORTCUT_EVENT, type ShortcutName } from '../features/docs/editor/commands'
import '../features/docs/editor/docEditor.css'
import { contentExtensions, uiExtensions } from '../features/docs/editor/extensions'
import DocIcon from '../features/docs/editor/icons'
import Outline from '../features/docs/editor/Outline'
import { renderThumbnail } from '../features/docs/editor/thumbnail'
import { toMarkdown } from '../features/docs/editor/toMarkdown'
import Toolbar, { Dropdown } from '../features/docs/editor/Toolbar'
import { useDocSession } from '../features/docs/editor/useDocSession'
import NewDocDialog from '../features/docs/NewDocDialog'
import SaveTemplateDialog from '../features/docs/SaveTemplateDialog'
import ShareDialog from '../features/docs/ShareDialog'
import type { CollabSession, CollabStatus, CollabUser } from '../lib/collab'
import { useToast } from '../components/ui/toastContext'

/** 문서 편집기 (/docs/:id): 구글 문서처럼 여럿이 동시에 쓰고 댓글을 단다 */
export default function DocEditorPage() {
  const { id } = useParams()
  const docId = Number(id)
  if (!Number.isInteger(docId) || docId <= 0) return <Navigate to="/docs" replace />
  // 다른 문서로 옮겨 가면 화면을 통째로 새로 만든다
  return <DocEditorScreen key={docId} docId={docId} />
}

function CenterMessage({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-3xl shadow-sm ring-1 ring-slate-200" aria-hidden>
        {icon}
      </span>
      <h2 className="text-lg font-bold text-slate-800">{title}</h2>
      {body && <p className="max-w-md text-sm text-slate-500">{body}</p>}
      {action}
    </div>
  )
}

const backToList = (
  <Link to="/docs" className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
    문서 목록으로
  </Link>
)

function DocEditorScreen({ docId }: { docId: number }) {
  const { load, status } = useDocSession(docId)

  if (load.state === 'slides') {
    return <CenterMessage icon="📊" title="슬라이드는 여기서 열 수 없습니다" body="이 화면은 문서만 엽니다." action={backToList} />
  }
  if (load.state === 'notfound' || (status === 'denied' && load.state !== 'ready')) {
    return (
      <CenterMessage
        icon="🔒"
        title="이 문서를 볼 권한이 없습니다"
        body="만든 사람이 공유하지 않은 개인 파일이거나 지워진 문서입니다. 만든 사람에게 공유를 부탁하세요."
        action={backToList}
      />
    )
  }
  if (load.state === 'error') return <CenterMessage icon="⚠️" title="문서를 불러오지 못했습니다" body={load.message} action={backToList} />
  if (load.state === 'loading') {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-sm text-slate-400">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" aria-hidden />
        {status === 'offline' ? '서버에 연결하지 못했습니다. 다시 연결하는 중...' : '문서를 여는 중...'}
      </div>
    )
  }
  return <Workspace initial={load.doc} session={load.session} me={load.me} status={status} />
}

/** 다른 사람 (같은 사람이 탭 여러 개로 들어와도 한 번만) */
function usePresence(session: CollabSession) {
  const [users, setUsers] = useState<{ id: number; name: string; color: string }[]>([])
  useEffect(() => {
    const read = () => {
      const seen = new Set<string>()
      const out: { id: number; name: string; color: string }[] = []
      session.awareness.getStates().forEach((st, clientId) => {
        const u = (st as { user?: CollabUser }).user
        if (clientId === session.awareness.clientID || !u?.name || seen.has(u.name)) return
        seen.add(u.name)
        out.push({ id: clientId, name: u.name, color: u.color })
      })
      setUsers(out)
    }
    const t = setTimeout(read, 0)
    session.awareness.on('change', read)
    return () => {
      clearTimeout(t)
      session.awareness.off('change', read)
    }
  }, [session])
  return users
}

function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((f) => f.type.startsWith('image/'))
}

async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return size
  } catch {
    return null
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** 파일 메뉴 한 줄 (누르면 감싼 칸이 메뉴를 닫는다) */
function FileMenuItem({
  children,
  onClick,
  hint,
  tip,
}: {
  children: React.ReactNode
  onClick: () => void
  hint?: string
  tip?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-tip={tip}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-8 px-3 py-1.5 text-left text-sm whitespace-nowrap text-slate-700 hover:bg-slate-100"
    >
      {children}
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </button>
  )
}

const SAVE_DELAY = 5000
/** 본문 폭 (A4 에서 양쪽 여백 25.4mm 를 뺀 것) 보다 큰 그림은 줄여서 넣는다 */
const MAX_IMAGE_W = 602

function Workspace({
  initial,
  session,
  me,
  status,
}: {
  initial: DocDetail
  session: CollabSession
  me: CollabUser
  status: CollabStatus
}) {
  const navigate = useNavigate()
  const [doc, setDoc] = useState<DocSummary>(initial)
  const [title, setTitle] = useState(initial.title)
  const [linkOpen, setLinkOpen] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(() => {
    try {
      return localStorage.getItem('docs.outline') !== '0'
    } catch {
      return true
    }
  })
  const [fileMenu, setFileMenu] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [openComments, setOpenComments] = useState(0)
  const [sharing, setSharing] = useState(false)
  const [templating, setTemplating] = useState(false)
  const [creating, setCreating] = useState(false)
  const toast = useToast()
  const [uploading, setUploading] = useState(0)
  const [saving, setSaving] = useState(false)
  const [lastError, setLastError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const flushRef = useRef<() => Promise<void>>(async () => {})
  const uploadRef = useRef<(files: File[], pos?: number) => void>(() => {})
  const readOnly = status === 'denied'
  const users = usePresence(session)

  const editor = useEditor(
    {
      extensions: [
        ...contentExtensions(),
        ...uiExtensions(),
        Collaboration.configure({ document: session.ydoc, field: 'default' }),
        CollaborationCaret.configure({ provider: session.provider, user: me }),
        DocShortcuts,
      ],
      editorProps: {
        attributes: { 'aria-label': '문서 본문', class: 'doc-prose' },
        handlePaste: (_view, event) => {
          const files = imageFiles(event.clipboardData)
          if (!files.length) return false
          uploadRef.current(files)
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false
          const files = imageFiles(event.dataTransfer)
          if (!files.length) return false
          event.preventDefault()
          uploadRef.current(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
          return true
        },
      },
    },
    [session],
  )

  const counts = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      chars: e.storage.characterCount?.characters?.() ?? 0,
      // 글을 골랐을 때 오른쪽 여백에 '댓글' 버튼, 링크 위에 있으면 링크 풍선
      sel: (() => {
        const { from, to, empty } = e.state.selection
        if (!e.view.dom.isConnected) return null
        try {
          const base = e.view.dom.getBoundingClientRect()
          const start = e.view.coordsAtPos(from)
          const end = e.view.coordsAtPos(to)
          return {
            empty,
            top: start.top - base.top,
            left: start.left - base.left,
            bottom: end.bottom - base.top,
            href: e.isActive('link') ? String(e.getAttributes('link').href ?? '') : '',
          }
        } catch {
          return null
        }
      })(),
    }),
  })

  function startComment() {
    if (!startCommentDraft(editor)) toast('댓글을 달 글을 먼저 고르세요.')
  }

  // 편집기 단축키(Ctrl+K·Ctrl+Alt+M·Ctrl+P·Ctrl+S)를 받아 화면이 할 일을 한다
  useEffect(() => {
    const dom = editor.view.dom
    const onShortcut = (e: Event) => {
      const name = (e as CustomEvent<ShortcutName>).detail
      if (name === 'link') setLinkOpen(true)
      else if (name === 'comment') {
        if (!startCommentDraft(editor)) toast('댓글을 달 글을 먼저 고르세요.')
      } else if (name === 'print') window.print()
      else if (name === 'save') {
        void flushRef.current()
        toast('자동으로 저장됩니다. 지금 내용도 저장했습니다.')
      }
    }
    dom.addEventListener(SHORTCUT_EVENT, onShortcut)
    return () => dom.removeEventListener(SHORTCUT_EVENT, onShortcut)
  }, [editor, toast])

  useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    document.title = `${title || '제목 없음'} - 문서`
    return () => {
      document.title = 'Piko View'
    }
  }, [title])

  // ---------------------------------------------------------------- 저장: 보통 JSON 사본 + 미리보기
  // 실제 내용은 공동 편집 서버가 몇 초마다 저장한다. 여기서는 목록 미리보기·내보내기·템플릿용 사본을 보낸다.
  useEffect(() => {
    let dirty = false
    let timer = 0
    let idle = 0
    const flush = async () => {
      window.clearTimeout(timer)
      if (!dirty || editor.isDestroyed) return
      dirty = false
      const json = editor.getJSON()
      const thumbnail = renderThumbnail(json)
      try {
        await api.updateDoc(initial.id, { snapshot: json as Record<string, unknown>, ...(thumbnail.length < 380_000 ? { thumbnail } : {}) })
        setLastError('')
      } catch (e) {
        dirty = true
        setLastError(errorText(e, '사본을 저장하지 못했습니다.'))
      }
    }
    flushRef.current = flush
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === session.provider) return // 다른 사람이 고친 것은 그 사람이 저장한다
      dirty = true
      setSaving(true)
      window.clearTimeout(idle)
      idle = window.setTimeout(() => setSaving(false), 1200)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void flush(), SAVE_DELAY)
    }
    // 창을 닫을 때: 응답을 기다리지 않는 요청으로 보낸다
    const onHide = () => {
      if (!dirty || editor.isDestroyed) return
      const body = JSON.stringify({ snapshot: editor.getJSON() })
      if (body.length > 60_000) return
      dirty = false
      void fetch(`${API_BASE}/docs/${initial.id}/`, {
        method: 'PATCH',
        keepalive: true,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...csrfHeader() },
        body,
      }).catch(() => {})
    }
    session.ydoc.on('update', onUpdate)
    window.addEventListener('pagehide', onHide)
    return () => {
      session.ydoc.off('update', onUpdate)
      window.removeEventListener('pagehide', onHide)
      window.clearTimeout(idle)
      if (dirty) void flush()
    }
  }, [editor, session, initial.id])

  // ---------------------------------------------------------------- 이미지 넣기
  useEffect(() => {
    uploadRef.current = (files, pos) => {
      if (readOnly) return
      for (const file of files) {
        setUploading((n) => n + 1)
        void (async () => {
          try {
            const size = await imageSize(file)
            const asset = await api.uploadDocAsset(initial.id, file, size?.width, size?.height)
            const scale = size && size.width > MAX_IMAGE_W ? MAX_IMAGE_W / size.width : 1
            const node = {
              type: 'image',
              attrs: {
                src: asset.url,
                alt: file.name,
                ...(size ? { width: Math.round(size.width * scale), height: Math.round(size.height * scale) } : {}),
              },
            }
            const chain = editor.chain().focus()
            if (pos !== undefined) chain.insertContentAt(pos, node).run()
            else chain.insertContent(node).run()
          } catch (e) {
            toast(errorText(e, '이미지를 올리지 못했습니다.'))
          } finally {
            setUploading((n) => n - 1)
          }
        })()
      }
    }
  })

  // ---------------------------------------------------------------- 파일 메뉴

  async function saveTitle() {
    const next = title.trim() || '제목 없음'
    setTitle(next)
    if (next === doc.title) return
    try {
      const d = await api.updateDoc(doc.id, { title: next })
      setDoc(d)
    } catch (e) {
      toast(errorText(e, '이름을 바꾸지 못했습니다.'))
      setTitle(doc.title)
    }
  }

  async function exportWord() {
    setFileMenu(false)
    toast('Word 파일을 만드는 중...')
    try {
      const { buildDocx, safeFileName } = await import('../features/docs/editor/exportDocx')
      const blob = await buildDocx(editor.getJSON(), title)
      download(blob, `${safeFileName(title)}.docx`)
      toast('Word 파일을 내려받았습니다.')
    } catch (e) {
      toast(errorText(e, 'Word 파일을 만들지 못했습니다.'))
    }
  }

  async function copyMarkdown() {
    setFileMenu(false)
    try {
      await navigator.clipboard.writeText(toMarkdown(editor.getJSON(), title))
      toast('Markdown 으로 복사했습니다. 지식 베이스 등에 붙여 넣으세요.')
    } catch {
      toast('복사하지 못했습니다.')
    }
  }

  async function duplicate() {
    setFileMenu(false)
    try {
      await flushRef.current()
      const copy = await api.duplicateDoc(doc.id)
      navigate(docPath(copy))
    } catch (e) {
      toast(errorText(e, '사본을 만들지 못했습니다.'))
    }
  }

  function setOutline(v: boolean) {
    setOutlineOpen(v)
    try {
      localStorage.setItem('docs.outline', v ? '1' : '0')
    } catch {
      // 기억하지 못해도 이번 화면에서는 따른다
    }
  }

  const back = '/docs'
  const statusView =
    status === 'denied'
      ? { text: '권한 없음', dot: 'bg-red-500', tip: '이 문서를 볼 권한이 없어 연결이 끊겼습니다' }
      : status === 'offline'
        ? { text: '오프라인', dot: 'bg-amber-500', tip: '연결이 끊겼습니다. 고친 내용은 이 브라우저에 남아 있다가 다시 연결되면 저장됩니다' }
        : status === 'connecting'
          ? { text: '연결 중...', dot: 'bg-slate-400 animate-pulse', tip: '공동 편집 서버에 연결하는 중입니다' }
          : saving
            ? { text: '저장 중...', dot: 'bg-blue-500 animate-pulse', tip: '고친 내용을 서버로 보내는 중입니다' }
            : { text: '저장됨', dot: 'bg-emerald-500', tip: '모든 변경 사항이 서버에 저장되었습니다. 저장 버튼을 누를 필요가 없습니다' }

  const sel = counts.sel

  return (
    <div className="doc-screen flex h-[calc(100dvh-5.75rem)] flex-col bg-slate-100 md:h-dvh">
      <header className="shrink-0 border-b border-slate-200 bg-white px-3 pt-2 pb-2 sm:px-4 print:hidden">
        <div className="flex items-center gap-2">
          <Link
            to={back}
            aria-label="뒤로"
            data-tip="문서 목록으로 돌아갑니다"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <DocIcon name="back" />
          </Link>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-600 text-white" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20zM9.5 11h6M9.5 14h6M9.5 17h4" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.currentTarget.blur()
                    editor.commands.focus()
                  }
                  if (e.key === 'Escape') {
                    setTitle(doc.title)
                    e.currentTarget.blur()
                  }
                }}
                readOnly={readOnly}
                aria-label="문서 이름"
                data-tip="눌러서 문서 이름을 바꿉니다"
                maxLength={200}
                size={Math.max(8, Math.min(48, title.length + 2))}
                className="min-w-0 truncate rounded-md border border-transparent px-1.5 py-0.5 text-[17px] font-semibold text-slate-900 transition hover:border-slate-300 focus:border-blue-500 focus:outline-none"
              />
              {doc.project ? (
                <span
                  data-tip="함께 쓰는 파일: 모든 사람이 보고 고칠 수 있습니다"
                  className="max-w-48 shrink-0 truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
                >
                  {doc.project_name}
                </span>
              ) : (
                <span
                  data-tip={doc.can_manage ? '내 파일: 나와 공유한 사람만 봅니다' : `${doc.owner_name} 님이 공유한 파일입니다`}
                  className="shrink-0 rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700"
                >
                  {doc.can_manage ? '내 파일' : `${doc.owner_name} 님이 공유`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 text-[13px]">
              <Dropdown
                label="파일 메뉴"
                tip="새로 만들기·사본·옮기기·템플릿·Word/PDF 내보내기"
                open={fileMenu}
                onOpenChange={setFileMenu}
                trigger={<span className="text-[13px]">파일</span>}
              >
                <div className="w-64" onClick={() => setFileMenu(false)}>
                  <FileMenuItem onClick={() => setCreating(true)} tip="새 문서를 만듭니다 (템플릿 선택)">새 문서</FileMenuItem>
                  <FileMenuItem onClick={() => void duplicate()} tip="같은 위치에 사본을 만들고 엽니다">사본 만들기</FileMenuItem>
                  <FileMenuItem onClick={() => setTemplating(true)} tip="지금 내용을 새 문서의 틀로 저장합니다">템플릿으로 저장</FileMenuItem>
                  <div className="my-1 border-t border-slate-100" />
                  <FileMenuItem onClick={() => void exportWord()} tip="Word 에서 열 수 있는 파일로 내려받습니다">Word(.docx)로 내려받기</FileMenuItem>
                  <FileMenuItem onClick={() => window.print()} hint="Ctrl+P" tip="인쇄 창에서 대상을 'PDF로 저장'으로 고르면 PDF 가 됩니다">PDF로 저장·인쇄</FileMenuItem>
                  <FileMenuItem onClick={() => void copyMarkdown()} tip="지식 베이스 등에 붙여 넣을 수 있게 복사합니다">Markdown으로 복사</FileMenuItem>
                  <div className="my-1 border-t border-slate-100" />
                  <FileMenuItem onClick={() => setSharing(true)} tip="함께 볼 사람을 고르거나 링크를 복사합니다">공유</FileMenuItem>
                  <FileMenuItem onClick={() => setHistoryOpen(true)} tip="해결된 댓글까지 모두 봅니다">댓글 기록</FileMenuItem>
                </div>
              </Dropdown>
              <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
              <span data-tip={statusView.tip} className="flex items-center gap-1.5 px-1 text-xs text-slate-500">
                <span className={`h-2 w-2 rounded-full ${statusView.dot}`} aria-hidden />
                {statusView.text}
              </span>
              {uploading > 0 && <span className="px-1 text-xs text-blue-600">이미지 올리는 중... ({uploading})</span>}
              <span className="ml-1 hidden px-1 text-xs text-slate-400 sm:inline" data-tip="공백을 뺀 글자 수가 아니라 모든 글자 수입니다">
                글자 {counts.chars.toLocaleString('ko-KR')}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {users.length > 0 && (
              <div className="mr-1 flex -space-x-1.5" role="group" aria-label="지금 보고 있는 사람">
                {users.slice(0, 5).map((u) => (
                  <span
                    key={u.id}
                    role="img"
                    aria-label={`${u.name} 님이 함께 보는 중`}
                    data-tip={`${u.name} 님이 함께 보고 있습니다`}
                    style={{ background: u.color }}
                    className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white ring-2 ring-white"
                  >
                    {u.name.slice(0, 1)}
                  </span>
                ))}
                {users.length > 5 && (
                  <span
                    role="img"
                    aria-label={`그 밖에 ${users.length - 5}명`}
                    className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 ring-2 ring-white"
                  >
                    +{users.length - 5}
                  </span>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label={openComments > 0 ? `댓글 기록 (열린 댓글 ${openComments}개)` : '댓글 기록'}
              data-tip="댓글 기록: 해결된 댓글까지 모두 봅니다"
              className="relative grid h-9 w-9 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100"
            >
              <DocIcon name="comment" />
              {openComments > 0 && (
                <span aria-hidden className="absolute top-0.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900">
                  {openComments}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSharing(true)}
              data-tip={doc.project ? '링크를 복사해 보냅니다 (프로젝트 파일은 모두가 봅니다)' : '함께 볼 사람을 고릅니다'}
              className="flex h-8 items-center rounded-lg border border-slate-300 px-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              공유
            </button>
          </div>
        </div>
        <div className="mt-2 overflow-x-auto">
          <Toolbar
            editor={editor}
            onPickImage={() => fileInput.current?.click()}
            onComment={startComment}
            onPrint={() => window.print()}
            linkOpen={linkOpen}
            setLinkOpen={setLinkOpen}
            outlineOpen={outlineOpen}
            onToggleOutline={() => setOutline(!outlineOpen)}
            readOnly={readOnly}
          />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length) uploadRef.current(files)
          }}
        />
      </header>

      {status === 'denied' && (
        <p className="shrink-0 bg-red-50 px-4 py-2 text-center text-sm text-red-700 print:hidden">
          이 문서를 볼 권한이 없습니다. 공유가 풀렸거나 문서가 옮겨졌습니다. 더 고칠 수 없습니다.
        </p>
      )}
      {status === 'offline' && (
        <p className="shrink-0 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 print:hidden">
          서버와 연결이 끊겼습니다. 계속 쓰셔도 됩니다 — 고친 내용은 이 브라우저에 남아 있다가 다시 연결되면 저장됩니다.
        </p>
      )}
      {lastError && status === 'connected' && (
        <p className="shrink-0 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-800 print:hidden">
          목록 미리보기를 저장하지 못했습니다 ({lastError}). 본문은 공동 편집 서버에 저장되고 있습니다.
        </p>
      )}

      <div className="doc-scroll doc-print-chain flex-1 overflow-auto">
        <div className="doc-print-chain flex min-h-full justify-center gap-6 px-2 py-3 sm:px-6 sm:py-6">
          {outlineOpen && (
            <aside className="sticky top-6 hidden w-52 shrink-0 self-start 2xl:block print:hidden">
              <Outline editor={editor} />
            </aside>
          )}
          <div className="doc-print-chain min-w-0 flex-[0_1_794px] sm:min-w-[540px]">
            <div
              className="doc-page doc-print-root min-h-[1123px] bg-white px-[clamp(16px,8%,96px)] py-10 sm:py-[88px] shadow-[0_1px_3px_rgb(15_23_42/0.08),0_0_0_1px_rgb(15_23_42/0.06)]"
              onMouseDown={(e) => {
                // 종이 여백을 눌러도 본문에 글쇠가 가게
                if (e.target === e.currentTarget) {
                  e.preventDefault()
                  editor.commands.focus('end')
                }
              }}
            >
              <div className="relative">
                <EditorContent editor={editor} />
                {sel && !sel.empty && !readOnly && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={startComment}
                    data-tip="고른 글에 댓글 달기 (Ctrl+Alt+M)"
                    style={{ top: sel.top - 4 }}
                    className="absolute -right-14 grid h-8 w-8 place-items-center rounded-full bg-white text-blue-600 shadow-md ring-1 ring-slate-200 transition hover:bg-blue-50 print:hidden"
                  >
                    <DocIcon name="comment" className="h-4 w-4" />
                  </button>
                )}
                {sel && sel.empty && sel.href && (
                  <div
                    style={{ top: sel.bottom + 6, left: Math.max(0, sel.left - 12) }}
                    className="absolute z-20 flex max-w-sm items-center gap-1 rounded-lg bg-white px-2 py-1.5 text-sm shadow-lg ring-1 ring-slate-200 print:hidden"
                  >
                    <a
                      href={sel.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-tip="새 탭에서 엽니다"
                      className="max-w-[16rem] truncate px-1 text-blue-600 hover:underline"
                    >
                      {sel.href}
                    </a>
                    {!readOnly && (
                      <>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setLinkOpen(true)}
                          className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                        >
                          고치기
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
                          className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                        >
                          링크 빼기
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="relative w-72 shrink-0 print:hidden">
            <CommentsPanel
              editor={editor}
              docId={doc.id}
              session={session}
              readOnly={readOnly}
              historyOpen={historyOpen}
              onHistoryOpenChange={setHistoryOpen}
              onCount={setOpenComments}
            />
          </div>
        </div>
      </div>

      {sharing && <ShareDialog doc={doc} onClose={() => setSharing(false)} onChanged={setDoc} />}
      <SaveTemplateDialog
        doc={templating ? { id: doc.id, kind: doc.kind, title } : null}
        onClose={() => setTemplating(false)}
        beforeSave={async () => {
          await flushRef.current()
          // 고친 것이 없어도 지금 본문으로 사본을 맞춘다
          await api.updateDoc(doc.id, { snapshot: editor.getJSON() as Record<string, unknown> })
        }}
        onSaved={(name) => toast(`'${name}' 템플릿으로 저장했습니다. 새 문서를 만들 때 고를 수 있습니다.`)}
      />
      <NewDocDialog open={creating} kind="doc" onClose={() => setCreating(false)} />
    </div>
  )
}
