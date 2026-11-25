import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { anchorFromView, caretTop, scrollParent, scrollViewToAnchor, type EditAnchor } from '../lib/editAnchor'
import { useConfirm } from './useConfirm'

export interface AttachResult {
  /** 본문에 넣을 Markdown (성공 시) */
  markdown?: string
  error?: string
}

export interface SuggestItem {
  id: string
  title: string
  hint?: string
}

interface Props {
  initialTitle: string
  initialBody: string
  titlePlaceholder?: string
  bodyPlaceholder?: string
  /** 처음에 본문에 커서를 둘지 (기존 문서 수정) — 아니면 제목에 */
  focusBody?: boolean
  /** 툴바 오른쪽 안내 문구 */
  hint?: string
  /** 보기 화면에서 읽던 자리. 주면 그 글자에 커서를 두고 같은 높이로 스크롤한다 */
  anchor?: EditAnchor | null
  /** 실패하면 throw — 편집 상태가 유지되고 메시지를 보여 준다. anchor: 보기로 돌아갈 때 맞출 자리 */
  onSave: (title: string, body: string, anchor: EditAnchor | null) => Promise<void>
  onCancel: (anchor: EditAnchor | null) => void
  onDirtyChange?: (dirty: boolean) => void
  renderPreview: (body: string) => ReactNode
  /** 파일을 올리고 본문에 넣을 Markdown 을 돌려준다. 없으면 첨부 기능을 숨긴다 */
  attach?: (files: File[]) => Promise<AttachResult[]>
  attachAccept?: string
  /** [[ 를 입력하면 보여 줄 연결 후보. 없으면 자동완성을 끈다 */
  suggest?: (query: string) => SuggestItem[]
  notify: (message: string) => void
  /** 툴바에 덧붙일 버튼. 지금 본문을 읽고 바꿀 수 있다 (바꾼 내용도 '고친 내용'으로 친다) */
  tools?: (ctx: { body: string; setBody: (body: string) => void }) => ReactNode
}

const REF = /\[\[([^[\]\n]{0,40})$/
const hasFiles = (e: React.DragEvent) => [...(e.dataTransfer?.types || [])].includes('Files')

/** 제목은 큰 입력칸, 본문은 Markdown 편집칸. 지식 베이스가 쓴다. */
export default function MarkdownEditor({
  initialTitle,
  initialBody,
  titlePlaceholder = '제목 없음',
  bodyPlaceholder = 'Markdown으로 작성하세요.',
  focusBody,
  hint,
  anchor,
  onSave,
  onCancel,
  onDirtyChange,
  renderPreview,
  attach,
  attachAccept,
  suggest,
  notify,
  tools,
}: Props) {
  const [ask, confirmEl] = useConfirm()
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fileOver, setFileOver] = useState(false)
  const [items, setItems] = useState<SuggestItem[]>([])
  const [sel, setSel] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const previewWrap = useRef<HTMLDivElement>(null)
  // 다음에 화면을 그린 뒤 맞출 자리 (처음엔 보기 화면에서 받은 것, 작성·미리보기를 오갈 때는 그때 자리)
  const pending = useRef<EditAnchor | null>(anchor ?? null)
  const dirty = title !== initialTitle || body !== initialBody

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  // 저장하지 않고 탭을 닫거나 새로고침하려 하면 브라우저가 한 번 묻는다
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  // 내용에 맞춰 높이를 늘린다. 재려고 잠깐 줄이는 동안 페이지가 짧아져 스크롤이 끌려 올라가지 않게 되돌린다
  useLayoutEffect(() => {
    const el = ta.current
    if (!el || preview) return
    const sp = scrollParent(el)
    const top = sp.scrollTop
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight + 2, 360)}px`
    sp.scrollTop = top
  }, [body, preview])

  // 처음 열 때와 작성·미리보기를 바꿀 때 읽던 자리를 잇는다 (높이를 맞춘 뒤에 돌아야 한다)
  useLayoutEffect(() => {
    // 지우지 않고 그대로 둔다: 개발 모드처럼 이 처리가 두 번 돌아도 같은 자리에 맞춰지고,
    // 다음 전환 때는 showPreview 가 새 자리로 바꿔 넣는다
    const a = pending.current
    if (preview) {
      const root = previewRoot()
      if (a && root) scrollViewToAnchor(root, body, a)
      return
    }
    const el = ta.current
    if (!el) return
    if (a) {
      const at = Math.min(a.offset, el.value.length)
      el.setSelectionRange(at, at)
      el.focus({ preventScroll: true })
      scrollParent(el).scrollTop += el.getBoundingClientRect().top + caretTop(el, at) - a.y
    } else if (focusBody) {
      el.setSelectionRange(0, 0)
      el.focus({ preventScroll: true })
    } else {
      titleRef.current?.focus({ preventScroll: true })
    }
    // body 는 그 순간의 값만 쓰면 되므로 preview 가 바뀔 때만 돈다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  function previewRoot(): HTMLElement | null {
    const wrap = previewWrap.current
    return wrap ? (wrap.querySelector<HTMLElement>('[data-md-root]') ?? wrap) : null
  }

  /** 지금 보고 있는 자리. 커서가 화면 밖이면 화면 위쪽 줄을 쓴다 */
  function currentAnchor(): EditAnchor | null {
    if (preview) {
      const root = previewRoot()
      return root ? anchorFromView(root, body) : null
    }
    const el = ta.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    const at = el.selectionStart
    const y = box.top + caretTop(el, at)
    if (y >= 0 && y <= window.innerHeight) return { offset: at, y }
    const ratio = Math.min(1, Math.max(0, (80 - box.top) / Math.max(1, box.height)))
    return { offset: Math.round(el.value.length * ratio), y: 80 }
  }

  function showPreview(on: boolean) {
    if (on === preview) return
    pending.current = currentAnchor()
    setPreview(on)
  }

  // [[ 를 치면 후보를 보여 주고, 고르면 [[제목]] 으로 완성한다
  function updateSuggest() {
    const el = ta.current
    if (!el || !suggest) return
    const m = el.value.slice(0, el.selectionStart).match(REF)
    if (!m) return setItems([])
    setItems(suggest(m[1].trim().toLowerCase()).slice(0, 7))
    setSel(0)
  }

  function pick(i: number) {
    const el = ta.current
    const x = items[i]
    if (!el || !x) return
    const pos = el.selectionStart
    const before = el.value.slice(0, pos).replace(REF, `[[${x.title}]]`)
    let after = el.value.slice(pos)
    if (after.startsWith(']]')) after = after.slice(2)
    setBody(before + after)
    setItems([])
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = before.length
    })
  }

  // 첨부: 파일을 올리고 커서 자리에 Markdown(이미지는 ![](...), 그 외는 [이름](...))을 넣는다
  async function doAttach(files: FileList | File[]) {
    const list = [...files]
    if (!list.length || !attach) return
    const el = ta.current
    const start = el ? el.selectionStart : body.length
    const end = el ? el.selectionEnd : body.length
    notify(`${list.length}개 파일을 첨부하는 중…`)
    try {
      const res = await attach(list)
      const ok = res.filter((r) => r.markdown)
      const bad = res.filter((r) => r.error)
      if (ok.length) {
        setBody((prev) => {
          const before = prev.slice(0, start)
          const lead = before && !before.endsWith('\n') ? '\n\n' : ''
          const text = `${lead}${ok.map((r) => r.markdown).join('\n\n')}\n`
          requestAnimationFrame(() => {
            if (ta.current) ta.current.selectionStart = ta.current.selectionEnd = start + text.length
          })
          return before + text + prev.slice(end)
        })
      }
      notify(bad.length ? bad[0].error! : `${ok.length}개 첨부했습니다. 저장하면 반영됩니다.`)
    } catch (e) {
      notify(e instanceof Error ? e.message : '첨부하지 못했습니다.')
    }
  }

  async function save() {
    const t = title.trim()
    if (!t) {
      notify('제목을 입력하세요.')
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await onSave(t, body, currentAnchor())
    } catch (e) {
      notify(e instanceof Error ? e.message : '저장하지 못했습니다.')
      setSaving(false)
    }
  }

  async function cancel() {
    if (dirty && !(await ask({ title: '고친 내용 버리기', message: '고친 내용을 버릴까요? 저장하지 않은 내용은 사라집니다.', confirmLabel: '버리기' }))) return
    onDirtyChange?.(false)
    onCancel(currentAnchor())
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      if (!saving) void save()
    } else if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (items.length) setItems([])
      else cancel()
    }
  }

  function onTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!items.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
    } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
      e.preventDefault()
      pick(sel)
    }
  }

  const segBtn = (on: boolean) =>
    `rounded-md px-3 py-1 text-xs transition max-sm:min-h-9 ${on ? 'bg-blue-600 font-semibold text-white' : 'text-slate-600 hover:bg-slate-50'}`

  const shortcuts = ['Ctrl+S 저장', 'Esc 취소', suggest && '[[ 로 문서 연결', attach && '파일은 끌어다 놓기']
    .filter(Boolean)
    .join(' · ')

  return (
    <div onKeyDown={onKeyDown}>
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={titlePlaceholder}
        aria-label="제목"
        className="mb-3 w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-2xl font-bold text-slate-800 focus:border-slate-300 focus:bg-white focus:outline-none sm:text-3xl"
      />

      {/* 휴대폰(md 미만)에서는 페이지 전체가 스크롤되므로 앱 위쪽 막대(약 90px) 아래에 붙는다 */}
      <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 bg-slate-100 py-2 max-md:top-[90px]">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          data-tip="제목과 본문을 저장합니다. Ctrl+S 로도 됩니다"
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50 max-sm:min-h-10"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 max-sm:min-h-10"
        >
          취소
        </button>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="편집 보기">
          <button
            type="button"
            className={segBtn(!preview)}
            aria-pressed={!preview}
            onClick={() => showPreview(false)}
            data-tip="Markdown 원문을 고치는 화면입니다"
          >
            작성
          </button>
          <button
            type="button"
            className={segBtn(preview)}
            aria-pressed={preview}
            onClick={() => showPreview(true)}
            data-tip="저장했을 때 보일 모습을 미리 봅니다"
          >
            미리보기
          </button>
        </div>
        {attach && (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              data-tip="이미지·PDF 등을 첨부합니다. 끌어다 놓거나 붙여 넣어도 됩니다"
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 transition hover:bg-white max-sm:min-h-10"
            >
              📎 첨부
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept={attachAccept}
              onChange={(e) => {
                if (e.target.files) void doAttach(e.target.files)
                e.target.value = ''
              }}
            />
          </>
        )}
        {tools?.({ body, setBody })}
        {/* 휴대폰에는 키보드 단축키가 없으니 안내(hint)만 남긴다 */}
        <span className="ml-auto text-xs text-slate-400">
          {hint && (
            <>
              {hint}
              <span className="max-sm:hidden"> · </span>
            </>
          )}
          <span className="max-sm:hidden">{shortcuts}</span>
        </span>
      </div>

      {preview ? (
        <div ref={previewWrap} className="min-h-[360px] rounded-xl border border-slate-200/80 bg-white px-4 py-5 sm:px-10 sm:py-9">
          {body.trim() ? renderPreview(body) : <p className="text-sm text-slate-400">(내용 없음)</p>}
        </div>
      ) : (
        <div className="relative">
          <textarea
            ref={ta}
            value={body}
            spellCheck={false}
            aria-label="본문"
            placeholder={bodyPlaceholder}
            onChange={(e) => {
              setBody(e.target.value)
              requestAnimationFrame(updateSuggest)
            }}
            onClick={updateSuggest}
            onBlur={() => window.setTimeout(() => setItems([]), 150)}
            onKeyDown={onTextareaKeyDown}
            onDragOver={(e) => {
              if (!attach || !hasFiles(e)) return
              e.preventDefault()
              setFileOver(true)
            }}
            onDragLeave={() => setFileOver(false)}
            onDrop={(e) => {
              if (!attach || !hasFiles(e)) return
              e.preventDefault()
              setFileOver(false)
              // 커서가 없으면 맨 끝에
              if (document.activeElement !== ta.current && ta.current) {
                ta.current.selectionStart = ta.current.selectionEnd = ta.current.value.length
              }
              void doAttach(e.dataTransfer.files)
            }}
            onPaste={(e) => {
              if (attach && e.clipboardData?.files?.length) {
                e.preventDefault() // 캡처 이미지 붙여 넣기
                void doAttach(e.clipboardData.files)
              }
            }}
            className={`w-full resize-none rounded-xl border bg-white px-4 py-5 text-base leading-[1.8] break-keep text-slate-800 shadow-sm focus:outline-none sm:px-8 sm:py-7 md:text-[15px] ${
              fileOver ? 'border-blue-400 ring-2 ring-blue-200' : 'border-slate-200 focus:border-blue-400'
            }`}
          />
          {items.length > 0 && (
            <div
              role="listbox"
              aria-label="연결할 문서"
              className="absolute top-2 right-2 left-2 z-20 max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
            >
              <div className="border-b border-slate-100 px-3 py-1.5 text-xs text-slate-400">
                연결할 문서 · ↑↓ 이동 · Enter 선택 · Esc 닫기
              </div>
              {items.map((x, i) => (
                <button
                  key={x.id}
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(i)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    i === sel ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span aria-hidden>📄</span>
                  <span className="truncate">{x.title}</span>
                  {x.hint && <span className="ml-auto shrink-0 truncate text-xs text-slate-400">{x.hint}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {confirmEl}
    </div>
  )
}
