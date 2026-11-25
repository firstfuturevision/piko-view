import { Suspense, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { matchPath, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ADMIN_URL } from '../api'
import { useAuth } from '../useAuth'
import { useBrand, useTemplate } from '../view/template'
import { activeModules, resolveNav, type NavGroup, type NavItem } from '../view/registry'
import Drawer from './Drawer'
import Icon from './Icon'
import TooltipLayer from './TooltipLayer'
import PageLoading from './PageLoading'

/** Piko Work(에이전트 작업 화면) 주소. 같은 창에서 넘어간다 */
const WORK_URL: string = import.meta.env.VITE_WORK_URL || '/agent-hub/'

function goWork() {
  window.location.assign(WORK_URL)
}

// 사이드바 접기 (이 브라우저에 기억)
const COLLAPSE_KEY = 'nav.collapsed'

function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

/** 왼쪽 위: "<이름> [Work | View]" — 이 화면(View)과 Piko Work(작업 화면)를 같은 창에서 오간다.
 * stacked 면 접은 사이드바용(세로) */
function PikoSwitch({ stacked = false }: { stacked?: boolean }) {
  const navigate = useNavigate()
  const brand = useBrand()
  const btn = (active: boolean) =>
    `rounded-md px-2.5 py-0.5 text-xs transition ${
      active ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'font-medium text-slate-500 hover:text-slate-800'
    } ${stacked ? 'px-1.5 text-[11px]' : ''}`
  return (
    <div className={`flex min-w-0 items-center ${stacked ? 'flex-col gap-1' : 'gap-2'}`}>
      <span className={`truncate font-bold tracking-tight text-slate-900 ${stacked ? 'max-w-12 text-[13px]' : 'text-[15px]'}`}>{brand}</span>
      <div
        role="tablist"
        aria-label="Work · View"
        className={`grid shrink-0 rounded-lg bg-slate-100 p-0.5 ${stacked ? 'grid-cols-1 gap-0.5' : 'grid-cols-2'}`}
      >
        <button
          type="button"
          role="tab"
          aria-selected={false}
          onClick={goWork}
          data-tip="Work — 에이전트 작업 화면"
          className={btn(false)}
        >
          Work
        </button>
        <button type="button" role="tab" aria-selected onClick={() => navigate('/')} data-tip="View — 현황·업무 화면" className={btn(true)}>
          View
        </button>
      </div>
    </div>
  )
}

// 사이드바 넓이: Piko Work 와 같은 키·범위를 써서 View·Work 를 오가도 그대로 (같은 도메인일 때)
const SIDE_KEY = 'agent-hub:sideW'
const SIDE_DEF = 260
const SIDE_MIN = 180
const SIDE_MAX = 480
const clampSide = (px: number) => Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, px)))
function savedSideW(): number {
  try {
    const v = Number(JSON.parse(localStorage.getItem(SIDE_KEY) ?? 'null'))
    return v ? clampSide(v) : SIDE_DEF
  } catch {
    return SIDE_DEF
  }
}
function storeSideW(px: number) {
  try {
    localStorage.setItem(SIDE_KEY, JSON.stringify(px))
  } catch {
    /* 저장 못 해도 이번 화면에서는 쓴다 */
  }
}

export default function AppLayout() {
  const { username, isStaff, logout } = useAuth()
  const { template } = useTemplate()
  const navigate = useNavigate()
  const groups = resolveNav(template)
  const modules = activeModules(template)
  // 좁은 화면 아래 탭: 메뉴 앞 3개 + Work + 더보기
  const tabItems = groups.flatMap((g) => g.items).slice(0, 3)
  const [collapsed, setCollapsedState] = useState(savedCollapsed)
  const [sideW, setSideW] = useState(savedSideW)
  const [resizing, setResizing] = useState(false)
  const navW = collapsed ? 64 : sideW
  const lastDown = useRef(0)
  function startResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault()
    // 두 번 누르면 기본 넓이 (pointerdown 을 막으면 dblclick 이 오지 않는 브라우저가 있어 직접 센다)
    const now = Date.now()
    if (now - lastDown.current < 400) {
      lastDown.current = 0
      setSideW(SIDE_DEF)
      storeSideW(SIDE_DEF)
      return
    }
    lastDown.current = now
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    let w = sideW
    let moved = false
    const move = (ev: PointerEvent) => {
      moved = true
      w = clampSide(ev.clientX)
      setSideW(w)
    }
    const up = () => {
      setResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (moved) {
        storeSideW(w)
        lastDown.current = 0
      }
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const [more, setMore] = useState(false)
  const { pathname } = useLocation()
  const navScroll = useRef<HTMLDivElement>(null)
  const mainScroll = useRef<HTMLDivElement>(null)
  const alsoOn = (item: NavItem) => (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`))
  /** 메뉴가 켜져 보이는지: 그 주소이거나, 묶은 다른 주소(also)에 있을 때 */
  const on = (item: NavItem, isActive: boolean) => isActive || alsoOn(item)

  // 켜진 메뉴가 사이드바 밖으로 밀려 있으면 보이게 굴린다
  useEffect(() => {
    const el = navScroll.current?.querySelector<HTMLElement>('[aria-current="page"], [data-also-on]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [pathname, collapsed])

  // 다른 화면으로 옮기면 새 화면은 맨 위에서 시작한다 (넓은 화면은 본문, 좁은 화면은 창이 스크롤한다)
  useEffect(() => {
    mainScroll.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [pathname])

  // 메뉴가 길어 위·아래로 더 있으면 흐린 띠와 화살표로 알린다
  const [edges, setEdges] = useState({ up: false, down: false })
  useEffect(() => {
    const el = navScroll.current
    if (!el) return
    const check = () => {
      const up = el.scrollTop > 4
      const down = el.scrollTop + el.clientHeight < el.scrollHeight - 4
      setEdges((p) => (p.up === up && p.down === down ? p : { up, down }))
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [collapsed])

  function setCollapsed(v: boolean) {
    setCollapsedState(v)
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0')
    } catch {
      // 기억하지 못해도 이번 화면에서는 따른다
    }
  }
  // 편집기처럼 화면을 꽉 채우는 주소, 스스로 칸을 나눠 스크롤하는 주소는 묶음(registry)이 알려 준다
  const fullBleed = modules.some((m) => (m.fullBleed ?? []).some((p) => matchPath(p, pathname) !== null))
  const selfScroll =
    fullBleed || modules.some((m) => (m.selfScroll ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`)))

  async function handleLogout() {
    setMore(false)
    await logout()
    navigate('/login', { replace: true })
  }

  const moreOn = !tabItems.some((t) => (t.end ? pathname === t.to : pathname === t.to || pathname.startsWith(`${t.to}/`)) || alsoOn(t))

  return (
    // 넓은 화면(md 이상): 창은 스크롤하지 않는다. 사이드바는 고정, 본문 영역만 화면 높이(100dvh) 안에서 스크롤한다.
    // 좁은 화면: 위 막대·아래 탭은 고정, 본문은 창과 함께 자연스럽게 아래로 스크롤
    <div
      className="min-h-dvh md:flex md:h-dvh md:min-h-0 md:overflow-hidden"
      style={{ '--nav-w': `${navW}px` } as CSSProperties}
    >
      {/* 좁은 화면: 위쪽 막대 (메뉴는 아래 탭) */}
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden">
        <PikoSwitch />
      </header>

      <nav
        aria-label="메뉴"
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200/80 bg-white md:flex ${resizing ? '' : 'transition-[width] duration-200'}`}
        style={{ width: navW }}
      >
        {/* 오른쪽 경계를 끌어 넓이 바꾸기 (180~480px, 두 번 누르면 기본 260px). 접었을 때는 없다 */}
        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="사이드바 넓이"
            aria-valuenow={sideW}
            aria-valuemin={SIDE_MIN}
            aria-valuemax={SIDE_MAX}
            data-tip="끌어서 넓이를 바꿉니다. 두 번 누르면 기본 넓이"
            onPointerDown={startResize}
            className="group absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none"
          >
            <span className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${resizing ? 'bg-blue-500' : 'bg-transparent group-hover:bg-slate-300'}`} />
          </div>
        )}
        <div className={`flex shrink-0 items-center pt-5 pb-4 [@media(max-height:820px)]:pt-3 [@media(max-height:820px)]:pb-2 ${collapsed ? 'flex-col gap-3 px-2' : 'justify-between gap-2 px-5'}`}>
          <PikoSwitch stacked={collapsed} />
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            aria-expanded={!collapsed}
            data-tip={collapsed ? '사이드바를 펼칩니다' : '사이드바를 접어 화면을 넓게 씁니다'}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="sidebar" />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {edges.up && (
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-white to-transparent" />
          )}
          <div
            ref={navScroll}
            className={`thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 ${collapsed ? 'px-2' : 'px-3'}`}
          >
            {groups.map((group, gi) => (
              <section key={`${gi}-${group.title}`} aria-label={group.title} className={gi > 0 ? (collapsed ? 'mt-2 border-t border-slate-100 pt-2' : 'mt-4 [@media(max-height:820px)]:mt-2.5') : ''}>
                {!collapsed && (
                  <h2 className="mb-1 px-3 text-[11px] font-semibold tracking-wide text-slate-400">{group.title}</h2>
                )}
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        data-also-on={alsoOn(item) || undefined}
                        aria-label={collapsed ? item.label : undefined}
                        data-tip={collapsed ? (item.tip ? `${item.label} · ${item.tip}` : item.label) : item.tip}
                        className={({ isActive }) =>
                          `flex items-center rounded-lg py-2 text-[14px] transition [@media(max-height:820px)]:py-1.5 ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-3'} ${
                            on(item, isActive)
                              ? 'bg-slate-100 font-semibold text-slate-900'
                              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <span className={on(item, isActive) ? 'text-blue-600' : ''}>
                              <Icon name={item.icon} />
                            </span>
                            {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {edges.down && (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => navScroll.current?.scrollBy({ top: navScroll.current.clientHeight * 0.7, behavior: 'smooth' })}
              data-tip="아래에 메뉴가 더 있습니다"
              className="absolute inset-x-0 bottom-0 z-10 flex h-8 items-end justify-center bg-gradient-to-t from-white via-white/90 to-transparent pb-1 text-slate-400 hover:text-slate-700"
            >
              <Icon name="chevronRight" className="h-4 w-4 rotate-90" />
            </button>
          )}
        </div>
        <div className={`shrink-0 border-t border-slate-100 ${collapsed ? 'space-y-1 p-2' : 'p-3 [@media(max-height:820px)]:p-2'}`}>
          <div className={`flex items-center py-1.5 ${collapsed ? 'justify-center' : 'gap-2.5 px-2'}`} data-tip={collapsed ? (username ?? undefined) : undefined}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 uppercase">
              {(username ?? '?').replace(/_/g, '').slice(0, 1) || '?'}
            </span>
            {!collapsed && <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{username}</p>}
          </div>
          <div className={`flex gap-1 ${collapsed ? 'flex-col' : 'mt-1'}`}>
            {isStaff && (
              <a
                href={ADMIN_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="관리자"
                data-tip="데이터를 직접 고치는 관리 화면을 새 탭에서 엽니다"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs whitespace-nowrap text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <Icon name="settings" className="h-4 w-4" />
                {!collapsed && '관리자'}
              </a>
            )}
            <button
              onClick={handleLogout}
              aria-label="로그아웃"
              data-tip={collapsed ? '로그아웃' : undefined}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs whitespace-nowrap text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            >
              <Icon name="logout" className="h-4 w-4" />
              {!collapsed && '로그아웃'}
            </button>
          </div>
        </div>
      </nav>
      {/* 사이드바는 화면 왼쪽에 위아래로 고정한다. 그 폭만큼 본문을 비켜 둔다 */}
      <div aria-hidden className={`hidden shrink-0 md:block ${resizing ? '' : 'transition-[width] duration-200'}`} style={{ width: navW }} />
      {/* 좁은 화면 아래 탭에 내용이 가리지 않도록 아래 여백 */}
      <div
        ref={mainScroll}
        data-app-scroll
        className={`min-w-0 flex-1 md:h-dvh md:pb-0 ${
          fullBleed ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]' : 'pb-[calc(5rem+env(safe-area-inset-bottom))]'
        } ${selfScroll ? 'md:overflow-hidden' : 'md:scroll-pane'}`}
      >
        {/* 따로 불러오는 화면(편집기 등)을 기다리는 동안에도 사이드바는 그대로 */}
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </div>

      {/* 좁은 화면: 아래 탭 */}
      <nav
        aria-label="메뉴"
        className="fixed inset-x-0 bottom-0 z-30 grid h-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        style={{ gridTemplateColumns: `repeat(${tabItems.length + 2}, minmax(0, 1fr))` }}
      >
        {tabItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] ${on(item, isActive) ? 'font-semibold text-blue-600' : 'text-slate-500'}`
            }
          >
            <Icon name={item.icon} className="h-5 w-5" />
            <span className="max-w-full truncate px-1">{item.label}</span>
          </NavLink>
        ))}
        {/* Work: 같은 창에서 에이전트 작업 화면으로 (왼쪽 위 [Work | View] 와 같다) */}
        <button type="button" onClick={goWork} className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-slate-500">
          <Icon name="bot" className="h-5 w-5" />
          Work
        </button>
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          aria-expanded={more}
          className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${moreOn ? 'font-semibold text-blue-600' : 'text-slate-500'}`}
        >
          <Icon name="menu" className="h-5 w-5" />
          더보기
        </button>
      </nav>
      {more && <MoreDrawer groups={groups} onClose={() => setMore(false)} isStaff={isStaff} username={username} onLogout={handleLogout} on={on} />}

      <TooltipLayer />
    </div>
  )
}

/** 좁은 화면 '더보기': 모든 메뉴 묶음과 관리자·로그아웃 */
function MoreDrawer({
  groups,
  onClose,
  isStaff,
  username,
  onLogout,
  on,
}: {
  groups: NavGroup[]
  onClose: () => void
  isStaff: boolean
  username: string | null
  onLogout: () => void
  on: (item: NavItem, isActive: boolean) => boolean
}) {
  const row = (active: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] ${active ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`
  return (
    <Drawer label="전체 메뉴" title="전체 메뉴" onClose={onClose} widthClass="max-w-xs" bodyClass="px-3 py-3">
      <div className="mb-3 px-3">
        <PikoSwitch />
      </div>
      {groups.map((group, gi) => (
        <section key={`${gi}-${group.title}`} aria-label={group.title} className="mb-3">
          <h2 className="mb-1 px-3 text-[11px] font-semibold tracking-wide text-slate-400">{group.title}</h2>
          <ul>
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} onClick={onClose} className={({ isActive }) => row(on(item, isActive))}>
                  <Icon name={item.icon} />
                  <span className="min-w-0 truncate">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ul className="border-t border-slate-100 pt-3">
        <li className={row(false)}>
          <Icon name="user" />
          <span className="truncate text-sm text-slate-500">{username}</span>
        </li>
        {isStaff && (
          <li>
            <a href={ADMIN_URL} target="_blank" rel="noreferrer" onClick={onClose} className={row(false)}>
              <Icon name="settings" />
              관리자
            </a>
          </li>
        )}
        <li>
          <button type="button" onClick={onLogout} className={`${row(false)} w-full`}>
            <Icon name="logout" />
            로그아웃
          </button>
        </li>
      </ul>
    </Drawer>
  )
}
