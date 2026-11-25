import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { UserSummary } from '../api'
import { shortRole } from '../lib/roles'

/** 화면에 보일 이름: 닉네임, 없으면 아이디 */
const userLabel = (u: UserSummary) => u.nickname || u.username

function matches(u: UserSummary, q: string) {
  const s = q.trim().toLowerCase()
  return !s || u.nickname.toLowerCase().includes(s) || u.username.toLowerCase().includes(s)
}

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none'

interface ListProps {
  id: string
  items: UserSummary[]
  active: number
  onPick: (u: UserSummary) => void
  onHover: (i: number) => void
}

function Suggestions({ id, items, active, onPick, onHover }: ListProps) {
  return (
    <ul
      id={id}
      role="listbox"
      className="absolute top-full right-0 left-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
    >
      {items.map((u, i) => (
        <li
          key={u.id}
          id={`${id}-${u.id}`}
          role="option"
          aria-selected={i === active}
          // 입력칸의 blur 보다 먼저 고르도록 mousedown 에서 처리
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(u)
          }}
          onMouseEnter={() => onHover(i)}
          title={u.role || undefined}
          className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
            i === active ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
          }`}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
            {userLabel(u).slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{userLabel(u)}</span>
            {u.role && <span className="block truncate text-xs text-slate-400">{shortRole(u.role, 60)}</span>}
          </span>
          {u.nickname && <span className="ml-auto shrink-0 self-start text-xs text-slate-400">{u.username}</span>}
        </li>
      ))}
    </ul>
  )
}

/** 위/아래로 고르고 Enter 로 확정, Esc 로 닫는 공통 키 처리 */
function useSuggest(items: UserSummary[], onPick: (u: UserSummary) => void, closeOnPick: boolean) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const shown = open && items.length > 0
  const index = Math.min(active, items.length - 1)

  function pick(u: UserSummary) {
    onPick(u)
    setActive(0)
    if (closeOnPick) setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (Math.min(a, items.length - 1) + step + items.length) % Math.max(items.length, 1))
    } else if (e.key === 'Enter' && shown) {
      e.preventDefault() // 폼 제출 대신 고르기
      pick(items[index])
    } else if (e.key === 'Escape' && shown) {
      e.stopPropagation() // 대화창까지 닫지 않는다
      setOpen(false)
    }
  }
  return { open, setOpen, active: index, setActive, shown, onKeyDown, pick }
}

/** 여러 명 고르기 (프로젝트 주요 담당자): 고른 사람은 칩으로, 입력하면 이름으로 찾는다 */
export function MultiUserPicker({
  label,
  hint,
  users,
  value,
  onChange,
}: {
  label: string
  hint?: string
  users: UserSummary[]
  value: number[]
  onChange: (ids: number[]) => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const chosen = value.map((v) => users.find((u) => u.id === v)).filter((u): u is UserSummary => !!u)
  const items = users.filter((u) => !value.includes(u.id) && matches(u, query))
  const s = useSuggest(
    items,
    (u) => {
      onChange([...value, u.id])
      setQuery('')
    },
    false,
  )

  return (
    <div className="text-sm text-slate-600">
      <label htmlFor={`${id}-input`}>
        {label} {hint && <span className="text-slate-400">({hint})</span>}
      </label>
      <div className="relative mt-1">
        <div
          onClick={() => input.current?.focus()}
          className="flex min-h-[38px] w-full flex-wrap items-center gap-1 rounded-lg border border-slate-300 bg-white px-1.5 py-1 focus-within:border-blue-500 focus-within:shadow-[0_0_0_3px_rgb(59_130_246/0.15)]"
        >
          {chosen.map((u) => (
            <span
              key={u.id}
              title={u.role || undefined}
              className="flex items-center gap-1 rounded-md bg-blue-50 py-0.5 pr-1 pl-2 text-[13px] text-blue-700"
            >
              {userLabel(u)}
              <button
                type="button"
                aria-label={`${userLabel(u)} 빼기`}
                onClick={() => onChange(value.filter((v) => v !== u.id))}
                className="rounded px-1 text-blue-400 hover:bg-blue-100 hover:text-blue-700"
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={input}
            id={`${id}-input`}
            type="text"
            role="combobox"
            aria-expanded={s.shown}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={s.shown ? `${id}-list-${items[s.active].id}` : undefined}
            value={query}
            placeholder={chosen.length ? '' : '이름을 입력해 찾기'}
            data-tip="이름을 쳐서 고르세요. 여러 명 넣을 수 있고, 지우기 키로 뺍니다"
            onChange={(e) => {
              setQuery(e.target.value)
              s.setOpen(true)
              s.setActive(0)
            }}
            onFocus={() => s.setOpen(true)}
            onBlur={() => s.setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1))
              else s.onKeyDown(e)
            }}
            className="min-w-[8rem] flex-1 border-0 bg-transparent px-1.5 py-1 text-sm outline-none focus:shadow-none"
          />
        </div>
        {s.shown && (
          <Suggestions id={`${id}-list`} items={items} active={s.active} onPick={s.pick} onHover={s.setActive} />
        )}
      </div>
    </div>
  )
}

/** 한 명 이름 입력 (태스크 담당자): 등록된 사용자를 추천하지만 바깥 사람 이름도 그대로 적을 수 있다 */
export function UserNameInput({
  label,
  users,
  value,
  onChange,
}: {
  label: string
  users: UserSummary[]
  value: string
  onChange: (name: string) => void
}) {
  const id = useId()
  const items = users.filter((u) => matches(u, value) && userLabel(u) !== value)
  const s = useSuggest(items, (u) => onChange(userLabel(u)), true)

  return (
    <label className="text-sm text-slate-600">
      {label}
      <div className="relative mt-1">
        <input
          type="text"
          role="combobox"
          aria-expanded={s.shown}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={s.shown ? `${id}-list-${items[s.active].id}` : undefined}
          value={value}
          placeholder="이름 입력 또는 선택"
          data-tip="목록에서 고르거나, 목록에 없는 사람 이름도 그대로 적으면 됩니다"
          onChange={(e) => {
            onChange(e.target.value)
            s.setOpen(true)
            s.setActive(0)
          }}
          onFocus={() => s.setOpen(true)}
          onBlur={() => s.setOpen(false)}
          onKeyDown={s.onKeyDown}
          className={inputClass}
        />
        {s.shown && <Suggestions id={`${id}-list`} items={items} active={s.active} onPick={s.pick} onHover={s.setActive} />}
      </div>
    </label>
  )
}
