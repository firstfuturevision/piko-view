import { createContext, useContext } from 'react'
import type { ViewTemplate } from '../api/view'

/** 서버가 템플릿을 못 줄 때 쓰는 기본 템플릿 (templates/default.json 과 같다) */
export const DEFAULT_TEMPLATE: ViewTemplate = {
  name: 'default',
  title: '기본',
  brand: 'Piko',
  modules: ['schedules', 'problems', 'kb', 'docs'],
  nav: [
    { title: '홈', items: [{ to: '/', label: '현황', icon: 'home' }, { module: 'schedules' }, { module: 'problems' }] },
    { title: '업무', items: [{ module: 'kb' }, { module: 'docs' }] },
  ],
  home: {
    stats: ['problems.attention', 'schedules.today'],
    panels: ['problems.attention', 'schedules.today', 'schedules.upcoming'],
  },
  labels: {},
}

export interface TemplateState {
  template: ViewTemplate
  /** 서버에서 받아 왔는지 (false 면 기본 템플릿) */
  loaded: boolean
  /** 불러오기가 끝났는지 (성공·실패 모두) */
  ready: boolean
}

export const TemplateContext = createContext<TemplateState>({ template: DEFAULT_TEMPLATE, loaded: false, ready: true })

export function useTemplate(): TemplateState {
  return useContext(TemplateContext)
}

/** 템플릿의 부르는 말 바꾸기: labels[key] 가 있으면 그것, 없으면 fallback */
export function labelOf(labels: Record<string, string> | undefined, key: string, fallback: string): string {
  const v = labels?.[key]
  return typeof v === 'string' && v.trim() ? v : fallback
}

/** label('lead', '영업 건') 처럼 쓴다 */
export function useLabel(): (key: string, fallback: string) => string {
  const { template } = useTemplate()
  return (key, fallback) => labelOf(template.labels, key, fallback)
}

/** 왼쪽 위 이름 (기본 Piko) */
export function useBrand(): string {
  const { template } = useTemplate()
  return template.brand?.trim() || 'Piko'
}
