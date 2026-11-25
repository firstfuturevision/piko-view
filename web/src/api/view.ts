import { request } from './client'

/** 왼쪽 메뉴 항목: 기능 묶음의 기본 메뉴({module}) 또는 직접 적은 메뉴({to,label,icon}) */
export interface TemplateNavItem {
  module?: string
  /** 묶음 안의 다른 화면 (registry 의 pages 키) */
  page?: string
  to?: string
  label?: string
  icon?: string
}

export interface TemplateNavGroup {
  title: string
  items: TemplateNavItem[]
}

/** GET /api/view/template — 지금 켜진 템플릿 (templates/*.json 과 같은 모양) */
export interface ViewTemplate {
  name: string
  title?: string
  brand?: string
  modules: string[]
  nav: TemplateNavGroup[]
  home?: { stats?: string[]; panels?: string[] }
  labels?: Record<string, string>
  /** 템플릿에 적혔지만 서버에 아직 없는 묶음 */
  missing?: string[]
}

export interface HomeCardItem {
  title: string
  sub?: string
  tag?: string
  url?: string
}

export interface HomeCard {
  label: string
  value: number | string
  items: HomeCardItem[]
}

/** GET /api/view/home — 첫 화면 카드. 키는 '묶음.이름' (예: schedules.today) */
export interface ViewHome {
  cards: Record<string, HomeCard>
}

export const viewApi = {
  viewTemplate: () => request<ViewTemplate>('/view/template'),
  viewHome: () => request<ViewHome>('/view/home'),
}
