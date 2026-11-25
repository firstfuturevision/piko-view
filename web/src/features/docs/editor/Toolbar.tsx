import FloatMenu from '../../../components/ui/FloatMenu'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clearFormatting } from './commands'
import DocIcon, { ColorGlyph, type DocIconName } from './icons'

// 문서 편집기 위쪽 도구 막대. 버튼을 눌러도 본문 선택이 풀리지 않도록 mousedown 을 막는다.

const TEXT_COLORS = [
  '#0f172a', '#475569', '#94a3b8', '#dc2626', '#ea580c', '#ca8a04',
  '#16a34a', '#0d9488', '#0891b2', '#2563eb', '#7c3aed', '#db2777',
]
const HIGHLIGHTS = ['#fef08a', '#fed7aa', '#fecaca', '#fbcfe8', '#e9d5ff', '#bfdbfe', '#a5f3fc', '#bbf7d0', '#e2e8f0']
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '30', '36', '48']

const STYLES: { key: string; label: string; tip: string }[] = [
  { key: 'p', label: '본문', tip: '보통 글 (Ctrl+Alt+0)' },
  { key: 'h1', label: '제목 1', tip: '가장 큰 제목 (Ctrl+Alt+1)' },
  { key: 'h2', label: '제목 2', tip: '중간 제목 (Ctrl+Alt+2)' },
  { key: 'h3', label: '제목 3', tip: '작은 제목 (Ctrl+Alt+3)' },
  { key: 'quote', label: '인용', tip: '다른 곳에서 가져온 말을 들여 씁니다' },
  { key: 'code', label: '코드', tip: '고정폭 글꼴로 코드를 씁니다' },
]

const ALIGNS: { key: string; icon: DocIconName; label: string }[] = [
  { key: 'left', icon: 'alignLeft', label: '왼쪽 맞춤 (Ctrl+Shift+L)' },
  { key: 'center', icon: 'alignCenter', label: '가운데 맞춤 (Ctrl+Shift+E)' },
  { key: 'right', icon: 'alignRight', label: '오른쪽 맞춤 (Ctrl+Shift+R)' },
  { key: 'justify', icon: 'alignJustify', label: '양쪽 맞춤 (Ctrl+Shift+J)' },
]

const keep = (e: React.MouseEvent) => e.preventDefault()

function Btn({
  icon,
  tip,
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  icon?: DocIconName
  tip: string
  label?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label ?? tip}
      aria-pressed={active}
      data-tip={tip}
      disabled={disabled}
      onMouseDown={keep}
      onClick={onClick}
      className={`grid h-8 min-w-8 place-items-center rounded-md px-1.5 transition disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {icon ? <DocIcon name={icon} /> : children}
    </button>
  )
}

const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" aria-hidden />

/** 누르면 아래로 펼치는 작은 창 (밖을 누르거나 Esc 면 닫힌다) */
/** 표 칸 색: 옅은 색만 (글자가 잘 읽히게) */
const CELL_COLORS: { label: string; value: string | null }[] = [
  { label: '없음', value: null },
  { label: '회색', value: '#f1f5f9' },
  { label: '파랑', value: '#eff6ff' },
  { label: '초록', value: '#ecfdf5' },
  { label: '노랑', value: '#fefce8' },
  { label: '주황', value: '#fff7ed' },
  { label: '빨강', value: '#fef2f2' },
  { label: '보라', value: '#f5f3ff' },
  { label: '연녹색', value: '#edf2ee' },
  { label: '녹색', value: '#dce7e0' },
]

export function Dropdown({
  trigger,
  tip,
  label,
  open,
  onOpenChange,
  children,
  align = 'left',
  active,
  wide,
}: {
  trigger: ReactNode
  tip: string
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  align?: 'left' | 'right'
  active?: boolean
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        data-tip={open ? undefined : tip}
        onMouseDown={keep}
        onClick={() => onOpenChange(!open)}
        className={`flex h-8 items-center gap-0.5 rounded-md px-1.5 text-sm transition ${
          open || active ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        } ${wide ? 'min-w-[5.5rem] justify-between' : ''}`}
      >
        {trigger}
        <DocIcon name="chevronDown" className="h-3 w-3 opacity-60" />
      </button>
      {/* 도구 막대가 옆으로 굴러가는 상자 안에 있어도 잘리지 않게 화면 맨 위 층에 띄운다 */}
      {open && (
        <FloatMenu anchor={ref} align={align} menuRef={menuRef}>
          {children}
        </FloatMenu>
      )}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  disabled,
  active,
  hint,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onMouseDown={keep}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-sm whitespace-nowrap transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
        active ? 'font-semibold text-blue-700' : 'text-slate-700'
      }`}
    >
      {children}
      {hint && <span className="text-[11px] font-normal text-slate-400">{hint}</span>}
    </button>
  )
}

/** 표 넣기: 칸을 훑어 크기를 고른다 */
function TableGrid({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const [hover, setHover] = useState({ r: 0, c: 0 })
  return (
    <div className="px-3 py-2">
      <div className="grid grid-cols-8 gap-0.5" onMouseLeave={() => setHover({ r: 0, c: 0 })}>
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8) + 1
          const c = (i % 8) + 1
          const on = r <= hover.r && c <= hover.c
          return (
            <button
              key={i}
              type="button"
              aria-label={`${r}×${c} 표`}
              onMouseDown={keep}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onPick(r, c)}
              className={`h-4 w-4 rounded-[3px] border ${on ? 'border-blue-400 bg-blue-100' : 'border-slate-300 bg-white'}`}
            />
          )
        })}
      </div>
      <p className="mt-1.5 text-center text-xs text-slate-500">{hover.r ? `${hover.r}행 × ${hover.c}열` : '크기를 고르세요'}</p>
    </div>
  )
}

/** 링크 주소 넣기 (열릴 때마다 지금 링크 주소로 시작) */
function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const [url, setUrl] = useState<string>(() => editor.getAttributes('link').href ?? '')
  const inLink = editor.isActive('link')

  function apply() {
    const href = url.trim()
    const chain = editor.chain().focus()
    if (!href) {
      chain.extendMarkRange('link').unsetLink().run()
    } else if (editor.state.selection.empty && !inLink) {
      // 고른 글이 없으면 주소를 글로 넣는다
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else {
      chain.extendMarkRange('link').setLink({ href }).run()
    }
    onDone()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
      className="flex w-80 items-center gap-2 px-3 py-2"
    >
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://… 주소를 붙여 넣으세요"
        aria-label="링크 주소"
        className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
      />
      <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
        {url.trim() || !inLink ? '적용' : '링크 빼기'}
      </button>
    </form>
  )
}

interface Props {
  editor: Editor
  /** 이미지 파일 고르기 창을 연다 */
  onPickImage: () => void
  onComment: () => void
  onPrint: () => void
  /** 링크 창 (Ctrl+K 로도 연다) */
  linkOpen: boolean
  setLinkOpen: (open: boolean) => void
  outlineOpen: boolean
  onToggleOutline: () => void
  readOnly: boolean
  /** 막대 끝에 붙일 단추 (선택) */
  extra?: ReactNode
}

export default function Toolbar({ editor, onPickImage, onComment, onPrint, linkOpen, setLinkOpen, outlineOpen, onToggleOutline, readOnly, extra }: Props) {
  const [menu, setMenu] = useState<string | null>(null)
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : e.isActive('blockquote')
              ? 'quote'
              : e.isActive('codeBlock')
                ? 'code'
                : 'p'
      const size = String(e.getAttributes('textStyle').fontSize ?? '').replace(/pt$/, '')
      return {
        style,
        size,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        color: String(e.getAttributes('textStyle').color ?? ''),
        highlight: e.isActive('highlight') ? String(e.getAttributes('highlight').color ?? '#fef08a') : '',
        align: ALIGNS.find((a) => e.isActive({ textAlign: a.key }))?.key ?? 'left',
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        link: e.isActive('link'),
        linkHref: String(e.getAttributes('link').href ?? ''),
        inTable: e.isActive('table'),
        canMerge: e.can().mergeCells(),
        canSplit: e.can().splitCell(),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        empty: e.state.selection.empty,
      }
    },
  })

  const chain = () => editor.chain().focus()
  const open = (key: string) => (v: boolean) => setMenu(v ? key : null)
  const close = () => setMenu(null)

  function setStyle(key: string) {
    const c = chain()
    if (key === 'p') c.setParagraph().run()
    else if (key === 'quote') c.setParagraph().toggleBlockquote().run()
    else if (key === 'code') c.toggleCodeBlock().run()
    else c.setHeading({ level: Number(key.slice(1)) as 1 | 2 | 3 }).run()
    close()
  }

  const styleLabel = STYLES.find((x) => x.key === s.style)?.label ?? '본문'

  return (
    <div
      role="toolbar"
      aria-label="서식 도구"
      className={`flex flex-wrap items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 ${readOnly ? 'pointer-events-none opacity-50' : ''}`}
    >
      <Btn icon="outline" tip={outlineOpen ? '왼쪽 개요(제목 목록)를 숨깁니다' : '왼쪽에 개요(제목 목록)를 보입니다'} active={outlineOpen} onClick={onToggleOutline} />
      <Sep />
      <Btn icon="undo" tip="되돌리기 (Ctrl+Z) · 내가 고친 것만 되돌립니다" disabled={!s.canUndo} onClick={() => chain().undo().run()} />
      <Btn icon="redo" tip="다시 하기 (Ctrl+Y)" disabled={!s.canRedo} onClick={() => chain().redo().run()} />
      <Btn icon="print" tip="인쇄·PDF로 저장 (Ctrl+P)" onClick={onPrint} />
      <Sep />

      <Dropdown
        label="글 모양"
        tip="본문·제목 1~3·인용·코드 중에서 고릅니다"
        open={menu === 'style'}
        onOpenChange={open('style')}
        wide
        trigger={<span className="px-1 text-[13px]">{styleLabel}</span>}
      >
        {STYLES.map((x) => (
          <MenuItem key={x.key} onClick={() => setStyle(x.key)} active={s.style === x.key} hint={x.tip.match(/\((.+)\)/)?.[1]}>
            <span
              className={
                x.key === 'h1'
                  ? 'text-xl font-bold'
                  : x.key === 'h2'
                    ? 'text-lg font-bold'
                    : x.key === 'h3'
                      ? 'text-base font-semibold'
                      : x.key === 'code'
                        ? 'font-mono text-[13px]'
                        : x.key === 'quote'
                          ? 'border-l-2 border-slate-300 pl-2 text-slate-500 italic'
                          : ''
              }
            >
              {x.label}
            </span>
          </MenuItem>
        ))}
      </Dropdown>
      <Sep />

      <Dropdown
        label="글자 크기"
        tip="글자 크기 (포인트)"
        open={menu === 'size'}
        onOpenChange={open('size')}
        trigger={<span className="w-6 text-center text-[13px] tabular-nums">{s.size || '11'}</span>}
      >
        <div className="max-h-72 overflow-y-auto">
          <MenuItem
            onClick={() => {
              chain().unsetFontSize().run()
              close()
            }}
            active={!s.size}
          >
            기본 (11)
          </MenuItem>
          {FONT_SIZES.map((v) => (
            <MenuItem
              key={v}
              active={s.size === v}
              onClick={() => {
                chain().setFontSize(`${v}pt`).run()
                close()
              }}
            >
              <span className="tabular-nums">{v}</span>
            </MenuItem>
          ))}
        </div>
      </Dropdown>
      <Sep />

      <Btn icon="bold" tip="굵게 (Ctrl+B)" active={s.bold} onClick={() => chain().toggleBold().run()} />
      <Btn icon="italic" tip="기울임 (Ctrl+I)" active={s.italic} onClick={() => chain().toggleItalic().run()} />
      <Btn icon="underline" tip="밑줄 (Ctrl+U)" active={s.underline} onClick={() => chain().toggleUnderline().run()} />
      <Btn icon="strike" tip="취소선 (Alt+Shift+5)" active={s.strike} onClick={() => chain().toggleStrike().run()} />
      <Dropdown
        label="글자 색"
        tip="글자 색"
        open={menu === 'color'}
        onOpenChange={open('color')}
        trigger={<ColorGlyph kind="text" color={s.color || '#0f172a'} />}
      >
        <div className="w-48 px-3 py-2">
          <div className="grid grid-cols-6 gap-1.5">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`글자 색 ${c}`}
                onMouseDown={keep}
                onClick={() => {
                  chain().setColor(c).run()
                  close()
                }}
                style={{ background: c }}
                className={`h-6 w-6 rounded-full ring-offset-1 transition hover:scale-110 ${s.color === c ? 'ring-2 ring-blue-500' : ''}`}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={keep}
            onClick={() => {
              chain().unsetColor().run()
              close()
            }}
            className="mt-2 w-full rounded-md py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            기본 색으로
          </button>
        </div>
      </Dropdown>
      <Dropdown
        label="형광펜"
        tip="형광펜 (글 뒤 바탕색)"
        open={menu === 'highlight'}
        onOpenChange={open('highlight')}
        trigger={<ColorGlyph kind="highlight" color={s.highlight || 'transparent'} />}
      >
        <div className="w-44 px-3 py-2">
          <div className="grid grid-cols-5 gap-1.5">
            {HIGHLIGHTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`형광펜 ${c}`}
                onMouseDown={keep}
                onClick={() => {
                  chain().setHighlight({ color: c }).run()
                  close()
                }}
                style={{ background: c }}
                className={`h-6 w-6 rounded-md ring-1 ring-slate-900/10 ring-offset-1 transition hover:scale-110 ${s.highlight === c ? 'ring-2 ring-blue-500' : ''}`}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={keep}
            onClick={() => {
              chain().unsetHighlight().run()
              close()
            }}
            className="mt-2 w-full rounded-md py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            형광펜 지우기
          </button>
        </div>
      </Dropdown>
      <Sep />

      <Dropdown
        label="링크"
        tip="링크 넣기·고치기 (Ctrl+K)"
        open={linkOpen}
        onOpenChange={setLinkOpen}
        active={s.link}
        trigger={<DocIcon name="link" />}
      >
        <LinkForm editor={editor} onDone={() => setLinkOpen(false)} />
      </Dropdown>
      <Btn icon="comment" tip="댓글 달기 (Ctrl+Alt+M) · 먼저 글을 고르세요" disabled={s.empty} onClick={onComment} />
      <Btn icon="image" tip="이미지 넣기 · 파일을 끌어 놓거나 붙여 넣어도 됩니다" onClick={onPickImage} />
      <Dropdown
        label="표"
        tip={s.inTable ? '표 고치기: 행·열 더하기/지우기, 칸 합치기' : '표 넣기'}
        open={menu === 'table'}
        onOpenChange={open('table')}
        active={s.inTable}
        trigger={<DocIcon name="table" />}
      >
        <div className="w-56">
          <p className="px-3 pt-1 pb-0.5 text-[11px] font-semibold text-slate-400">새 표 넣기</p>
          <TableGrid
            onPick={(rows, cols) => {
              chain().insertTable({ rows, cols, withHeaderRow: true }).run()
              close()
            }}
          />
          {s.inTable && (
            <>
              <div className="my-1 border-t border-slate-100" />
              {(
                [
                  ['위에 행 넣기', () => chain().addRowBefore().run()],
                  ['아래에 행 넣기', () => chain().addRowAfter().run()],
                  ['왼쪽에 열 넣기', () => chain().addColumnBefore().run()],
                  ['오른쪽에 열 넣기', () => chain().addColumnAfter().run()],
                ] as const
              ).map(([label, fn]) => (
                <MenuItem key={label} onClick={() => { fn(); close() }}>
                  {label}
                </MenuItem>
              ))}
              <div className="my-1 border-t border-slate-100" />
              <MenuItem onClick={() => { chain().deleteRow().run(); close() }}>행 지우기</MenuItem>
              <MenuItem onClick={() => { chain().deleteColumn().run(); close() }}>열 지우기</MenuItem>
              <div className="my-1 border-t border-slate-100" />
              <MenuItem disabled={!s.canMerge} hint="여러 칸을 고른 뒤" onClick={() => { chain().mergeCells().run(); close() }}>
                칸 합치기
              </MenuItem>
              <MenuItem disabled={!s.canSplit} onClick={() => { chain().splitCell().run(); close() }}>
                칸 나누기
              </MenuItem>
              <div className="my-1 border-t border-slate-100" />
              <p className="px-3 pt-0.5 pb-1 text-[11px] font-semibold text-slate-400">칸 색 (고른 칸)</p>
              <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                {CELL_COLORS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    aria-label={`칸 색 ${c.label}`}
                    data-tip={c.label}
                    onMouseDown={keep}
                    onClick={() => {
                      chain().setCellAttribute('backgroundColor', c.value).run()
                      close()
                    }}
                    className="grid h-6 w-6 place-items-center rounded ring-1 ring-slate-300 hover:ring-slate-500"
                    style={{ background: c.value ?? '#ffffff' }}
                  >
                    {c.value === null && <span className="text-[10px] text-slate-400">없음</span>}
                  </button>
                ))}
              </div>
              <MenuItem
                onClick={() => {
                  chain().setCellAttribute('borderless', !editor.getAttributes('tableCell').borderless && !editor.getAttributes('tableHeader').borderless).run()
                  close()
                }}
              >
                칸 테두리 없애기/보이기
              </MenuItem>
              <MenuItem onClick={() => { chain().toggleHeaderRow().run(); close() }}>머리글 행 켜기/끄기</MenuItem>
              <MenuItem onClick={() => { chain().toggleHeaderColumn().run(); close() }}>머리글 열 켜기/끄기</MenuItem>
              <div className="my-1 border-t border-slate-100" />
              <MenuItem onClick={() => { chain().deleteTable().run(); close() }}>
                <span className="text-red-600">표 지우기</span>
              </MenuItem>
            </>
          )}
        </div>
      </Dropdown>
      <Sep />

      <Dropdown
        label="맞춤"
        tip="글 맞춤 (왼쪽·가운데·오른쪽·양쪽)"
        open={menu === 'align'}
        onOpenChange={open('align')}
        trigger={<DocIcon name={ALIGNS.find((a) => a.key === s.align)?.icon ?? 'alignLeft'} />}
      >
        <div className="flex gap-0.5 px-1.5">
          {ALIGNS.map((a) => (
            <Btn
              key={a.key}
              icon={a.icon}
              tip={a.label}
              active={s.align === a.key}
              onClick={() => {
                chain().setTextAlign(a.key).run()
                close()
              }}
            />
          ))}
        </div>
      </Dropdown>
      <Btn icon="bulletList" tip="글머리 기호 목록 (Ctrl+Shift+8)" active={s.bullet} onClick={() => chain().toggleBulletList().run()} />
      <Btn icon="orderedList" tip="번호 목록 (Ctrl+Shift+7)" active={s.ordered} onClick={() => chain().toggleOrderedList().run()} />
      <Btn icon="taskList" tip="체크리스트 (Ctrl+Shift+9) · 네모를 눌러 완료 표시" active={s.task} onClick={() => chain().toggleTaskList().run()} />
      <Btn icon="outdent" tip="내어쓰기 (Ctrl+[ 또는 Shift+Tab)" onClick={() => chain().outdent().run()} />
      <Btn icon="indent" tip="들여쓰기 (Ctrl+] 또는 Tab)" onClick={() => chain().indent().run()} />
      <Sep />
      <Btn icon="hr" tip="가로줄 넣기" onClick={() => chain().setHorizontalRule().run()} />
      <Btn icon="clear" tip="서식 지우기 (Ctrl+\) · 굵게·색·크기 등을 없앱니다" onClick={() => clearFormatting(editor)} />
      {extra && (
        <>
          <Sep />
          {extra}
        </>
      )}
    </div>
  )
}
