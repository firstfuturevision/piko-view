import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { useAuth } from '../useAuth'
import { DEFAULT_TEMPLATE, TemplateContext, type TemplateState } from './template'

/** 로그인하면 /api/view/template 을 불러 화면 전체에 나눠 준다. 못 불러오면 기본 템플릿 */
export default function TemplateProvider({ children }: { children: ReactNode }) {
  const { username } = useAuth()
  // 어느 사용자 것으로 불러왔는지 (사용자가 바뀌면 다시 불러온다)
  const [state, setState] = useState<TemplateState & { for: string | null }>({
    template: DEFAULT_TEMPLATE,
    loaded: false,
    ready: false,
    for: null,
  })

  useEffect(() => {
    if (!username) return
    let alive = true
    api
      .viewTemplate()
      .then((t) => {
        if (!alive) return
        const ok = t && Array.isArray(t.nav)
        setState({
          template: ok ? { ...DEFAULT_TEMPLATE, ...t, labels: t.labels ?? {} } : DEFAULT_TEMPLATE,
          loaded: Boolean(ok),
          ready: true,
          for: username,
        })
      })
      .catch(() => {
        if (alive) setState({ template: DEFAULT_TEMPLATE, loaded: false, ready: true, for: username })
      })
    return () => {
      alive = false
    }
  }, [username])

  const brand = state.template.brand?.trim() || 'Piko'
  useEffect(() => {
    document.title = `${brand} View`
  }, [brand])

  const value: TemplateState = {
    template: state.template,
    loaded: state.loaded,
    // 로그인 전에는 기다릴 것이 없다
    ready: !username || (state.ready && state.for === username),
  }
  return <TemplateContext.Provider value={value}>{children}</TemplateContext.Provider>
}
