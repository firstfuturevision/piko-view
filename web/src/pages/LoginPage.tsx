import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../useAuth'
import { useBrand } from '../view/template'

/** 로그인 뒤 돌아갈 곳(?next=). 이 사이트 안의 경로('/…')만 받는다 — '//…'·'/\\…' 같은 다른 사이트 주소는 버린다 */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}

export default function LoginPage() {
  const { login } = useAuth()
  const brand = useBrand()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username, password)
      const next = safeNext(params.get('next'))
      navigate(next ?? '/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl bg-white p-8 shadow"
      >
        <h1 className="mb-6 text-center text-[22px] font-bold tracking-tight text-slate-900">
          {brand} View
        </h1>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-slate-600">
            아이디
          </span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="mb-6 block">
          <span className="mb-1 block text-sm font-medium text-slate-600">
            비밀번호
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? '로그인 중...' : '로그인'}
        </button>
        <p className="mt-4 text-center text-xs text-slate-400">
          계정은 관리자에게 문의하세요.
        </p>
      </form>
    </div>
  )
}
