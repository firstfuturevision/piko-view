import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, type HomeCard, type HomeCardItem } from '../api'
import Icon from '../components/Icon'
import EmptyState from '../components/ui/EmptyState'
import { activeModules, moduleOf } from '../view/registry'
import { useLabel, useTemplate } from '../view/template'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** 'schedules.today' → 'schedules' 묶음이 켜져 있으면 그 메뉴 주소 */
function useCardLink() {
  const { template } = useTemplate()
  const active = new Set(activeModules(template).map((m) => m.name))
  return (key: string) => {
    const name = key.split('.')[0]
    return active.has(name) ? moduleOf(name) : undefined
  }
}

/** 현황(첫 화면): 템플릿 home.stats 는 위 숫자 칸, home.panels 는 아래 목록 칸. 카드는 /api/view/home 이 준다 */
export default function HomePage() {
  const navigate = useNavigate()
  const { template } = useTemplate()
  const label = useLabel()
  const linkOf = useCardLink()
  const [cards, setCards] = useState<Record<string, HomeCard> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api
      .viewHome()
      .then((r) => alive && setCards(r?.cards ?? {}))
      .catch((err) => {
        if (!alive) return
        if (err instanceof ApiError && err.status === 403) {
          navigate('/login', { replace: true })
          return
        }
        setCards({})
        setError(err instanceof Error ? err.message : '현황을 불러오지 못했습니다.')
      })
    return () => {
      alive = false
    }
  }, [navigate])

  const loading = cards === null
  // 모르는 카드 이름은 건너뛴다 (불러오는 동안은 자리만)
  const pick = (keys: string[] | undefined) => (keys ?? []).filter((k) => loading || Boolean(cards?.[k]))
  const stats = pick(template.home?.stats)
  const panels = pick(template.home?.panels)
  const now = new Date()

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <p className="text-sm text-slate-400">
        {now.getMonth() + 1}월 {now.getDate()}일 {WEEKDAY[now.getDay()]}요일
      </p>
      <h2 className="mt-0.5 mb-6 text-[22px] font-bold tracking-tight text-slate-900">{label('home', '현황')}</h2>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {stats.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((key) => {
            const card = cards?.[key]
            const m = linkOf(key)
            const warn = key.endsWith('.attention') && Number(card?.value) > 0
            return (
              <Stat
                key={key}
                to={m?.nav.to}
                icon={m ? <Icon name={m.nav.icon} className="h-4 w-4" /> : null}
                label={card ? label(key, card.label) : '…'}
                value={card ? card.value : '–'}
                warn={warn}
              />
            )
          })}
        </div>
      )}

      {panels.length > 0 ? (
        // 칸(min-w-0): 한 줄로 자르는 긴 글(truncate)이 칸을 화면보다 넓게 늘리지 않게
        <div className="grid gap-4 lg:grid-cols-2">
          {panels.map((key) => {
            const card = cards?.[key]
            return (
              <Panel key={key} title={card ? label(key, card.label) : '…'} to={linkOf(key)?.nav.to}>
                {!card ? (
                  <EmptyState plain>불러오는 중...</EmptyState>
                ) : card.items.length === 0 ? (
                  <EmptyState plain>아직 없습니다.</EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {card.items.map((item, i) => (
                      <li key={i}>
                        <ItemRow item={item} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )
          })}
        </div>
      ) : (
        !loading &&
        stats.length === 0 && <EmptyState>템플릿에 첫 화면 카드(home.stats · home.panels)가 없습니다.</EmptyState>
      )}
    </main>
  )
}

function ItemRow({ item }: { item: HomeCardItem }) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-700">{item.title}</p>
        {item.sub && <p className="mt-0.5 truncate text-xs text-slate-400">{item.sub}</p>}
      </div>
      {item.tag && (
        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 tabular-nums">{item.tag}</span>
      )}
    </>
  )
  const cls = '-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5'
  if (!item.url) return <div className={cls}>{body}</div>
  // 이 화면 안 주소('/…')는 화면 전환, 그 밖은 새 탭
  if (item.url.startsWith('/') && !item.url.startsWith('//')) {
    return (
      <Link to={item.url} className={`${cls} transition hover:bg-slate-50`}>
        {body}
      </Link>
    )
  }
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className={`${cls} transition hover:bg-slate-50`}>
      {body}
    </a>
  )
}

function Stat({ to, icon, label, value, warn }: { to?: string; icon: ReactNode; label: string; value: number | string; warn?: boolean }) {
  const inner = (
    <>
      <div className="flex items-center gap-2 text-[13px] text-slate-500">
        <span className={warn ? 'text-amber-500' : 'text-slate-400 group-hover:text-blue-600'}>{icon}</span>
        {label}
      </div>
      <p className={`mt-2 text-[28px] leading-none font-bold tabular-nums ${warn ? 'text-amber-600' : 'text-slate-900'}`}>{value}</p>
    </>
  )
  const cls = 'group rounded-xl border border-slate-200/80 bg-white p-4 transition'
  return to ? (
    <Link to={to} className={`${cls} hover:border-slate-300 hover:shadow-sm`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  )
}

function Panel({ title, to, children }: { title: string; to?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white px-5 pt-4 pb-2">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-slate-800">{title}</h3>
        {to && (
          <Link to={to} className="text-xs text-slate-400 transition hover:text-blue-600 max-md:-my-2 max-md:py-3">
            전체 보기 →
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}
