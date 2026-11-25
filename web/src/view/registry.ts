import { lazy, type ComponentType } from 'react'
import type { TemplateNavItem, ViewTemplate } from '../api/view'
import { iconOf, type IconName } from '../components/iconPaths'
import ProblemPage from '../pages/ProblemPage'
import SchedulePage from '../pages/SchedulePage'
import DocsPage from '../pages/DocsPage'
import { labelOf } from './template'

// 지식 베이스·문서 편집기는 커서 처음 열 때 불러온다
const KBPage = lazy(() => import('../pages/KBPage'))
const DocEditorPage = lazy(() => import('../pages/DocEditorPage'))

/** 왼쪽 메뉴 한 줄 */
export interface NavItem {
  to: string
  label: string
  icon: IconName
  /** 주소가 정확히 같을 때만 켜진다 (첫 화면 '/') */
  end?: boolean
  tip?: string
  /** 이 주소들에 있을 때도 켜진 메뉴로 보인다 */
  also?: string[]
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

/** 메뉴 기본값. label 은 템플릿 labels[labelKey] 로 바꿀 수 있다 */
export interface ModuleNav extends Omit<NavItem, 'label'> {
  label: string
  /** 템플릿 labels 에서 찾을 키 (없으면 묶음 이름) */
  labelKey?: string
}

export interface ViewModule {
  /** 템플릿의 modules · nav[].module 에 적는 이름 */
  name: string
  /** 이 묶음이 맡는 주소 (react-router path) */
  routes: { path: string; component: ComponentType }[]
  /** 템플릿에 { "module": 이름 } 만 적었을 때 보일 메뉴 */
  nav: ModuleNav
  /** { "module": 이름, "page": 키 } 로 고를 수 있는 다른 메뉴 */
  pages?: Record<string, ModuleNav>
  /** 화면을 꽉 채우는 주소 (아래 여백·본문 스크롤 없이). react-router 패턴 */
  fullBleed?: string[]
  /** 스스로 칸을 나눠 스크롤하는 주소 앞부분 */
  selfScroll?: string[]
}

/** 프론트엔드 기능 묶음 목록. 새 묶음은 여기에 한 줄 더한다 (README 참고) */
export const MODULES: ViewModule[] = [
  {
    name: 'schedules',
    routes: [{ path: '/schedules', component: SchedulePage }],
    nav: { to: '/schedules', label: '일정', icon: 'calendar', tip: '일정을 달력에 올리고 끝난 일은 완료 표시합니다' },
  },
  {
    name: 'problems',
    routes: [{ path: '/problems', component: ProblemPage }],
    nav: { to: '/problems', label: '문제 해결', icon: 'problem', tip: '막힌 문제를 등록하고 오너·기한을 정해 풉니다' },
  },
  {
    name: 'kb',
    routes: [{ path: '/kb/*', component: KBPage }],
    nav: { to: '/kb', label: '지식 베이스', icon: 'book', tip: '회사 문서를 찾고, 쓰고, 연결해 둡니다' },
    selfScroll: ['/kb'],
  },
  {
    name: 'docs',
    routes: [
      { path: '/docs', component: DocsPage },
      { path: '/docs/:id', component: DocEditorPage },
    ],
    nav: { to: '/docs', label: '문서', icon: 'doc', tip: '여럿이 함께 쓰는 문서를 만들고 고칩니다' },
    fullBleed: ['/docs/:id'],
  },
]

const BY_NAME = new Map(MODULES.map((m) => [m.name, m]))

export function moduleOf(name: string): ViewModule | undefined {
  return BY_NAME.get(name)
}

/** 템플릿이 켰고, 프론트엔드에 있고, 서버에도 있는(missing 이 아닌) 묶음 */
export function activeModules(t: ViewTemplate): ViewModule[] {
  const missing = new Set(t.missing ?? [])
  const wanted = new Set(t.modules ?? [])
  return MODULES.filter((m) => wanted.has(m.name) && !missing.has(m.name))
}

function navOf(m: ViewModule, item: TemplateNavItem, labels: ViewTemplate['labels']): NavItem | null {
  const base = item.page ? m.pages?.[item.page] : m.nav
  if (!base) return null
  const key = base.labelKey ?? (item.page ? `${m.name}.${item.page}` : m.name)
  const { labelKey: _ignored, ...rest } = base
  void _ignored
  return {
    ...rest,
    // 템플릿 항목에 label·icon 을 적었으면 그것을 쓴다
    label: item.label ?? labelOf(labels, key, base.label),
    icon: item.icon ? iconOf(item.icon, base.icon) : base.icon,
  }
}

/** 템플릿 nav → 왼쪽 메뉴 묶음. 없는 묶음의 항목은 빠지고, 빈 묶음 제목도 빠진다 */
export function resolveNav(t: ViewTemplate): NavGroup[] {
  const active = new Set(activeModules(t).map((m) => m.name))
  const groups: NavGroup[] = []
  for (const g of t.nav ?? []) {
    const items: NavItem[] = []
    for (const item of g.items ?? []) {
      if (item.module) {
        const m = active.has(item.module) ? BY_NAME.get(item.module) : undefined
        const nav = m && navOf(m, item, t.labels)
        if (nav) items.push(nav)
      } else if (item.to) {
        items.push({ to: item.to, label: item.label ?? item.to, icon: iconOf(item.icon), end: item.to === '/' })
      }
    }
    // 같은 주소가 두 번 나오지 않게
    const seen = new Set<string>()
    const unique = items.filter((i) => !seen.has(i.to) && seen.add(i.to))
    if (unique.length) groups.push({ title: g.title, items: unique })
  }
  return groups
}
