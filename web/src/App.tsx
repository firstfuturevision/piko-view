import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import { useAuth } from './useAuth'
import AppLayout from './components/AppLayout'
import ToastProvider from './components/ui/Toast'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import TemplateProvider from './view/TemplateProvider'
import { activeModules } from './view/registry'
import { useTemplate } from './view/template'

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-400">
      불러오는 중...
    </div>
  )
}

function Protected({ children }: { children: React.ReactNode }) {
  const { username, loading } = useAuth()
  if (loading) return <Loading />
  if (!username) return <Navigate to="/login" replace />
  return children
}

/** 주소 목록: 첫 화면·로그인은 늘 있고, 나머지는 템플릿이 켠 묶음(registry)이 더한다 */
function AppRoutes() {
  const { template, ready } = useTemplate()
  if (!ready) return <Loading />
  const modules = activeModules(template)
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route path="/" element={<HomePage />} />
        {modules.flatMap((m) =>
          m.routes.map(({ path, component: Page }) => <Route key={`${m.name}:${path}`} path={path} element={<Page />} />),
        )}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <TemplateProvider>
        <ToastProvider>
          {/* 하위 주소(VITE_BASE)에 올려도 되게 basename 을 맞춘다 */}
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </TemplateProvider>
    </AuthProvider>
  )
}
