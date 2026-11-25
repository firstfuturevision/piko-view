// 배포 시 백엔드가 다른 origin이면 VITE_API_BASE로 지정 (예: https://api.example.com/api)
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

/** Django 어드민 페이지 주소.
 * 같은 origin에서 프록시로 서비스하면 /admin/,
 * API가 다른 origin(VITE_API_BASE)이면 그 origin의 /admin/ 을 가리킨다. */
export const ADMIN_URL = /^https?:\/\//.test(API_BASE)
  ? new URL('/admin/', API_BASE).toString()
  : '/admin/'

// CSRF 토큰은 auth 응답(me/login/logout) 본문으로 받아 메모리에 보관한다.
// 쿠키는 백엔드 도메인 소유라 cross-site 배포에서는 JS로 읽을 수 없기 때문.
let csrfToken: string | null = null

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function rememberCsrf(body: unknown) {
  if (
    body &&
    typeof body === 'object' &&
    'csrftoken' in body &&
    typeof (body as { csrftoken: unknown }).csrftoken === 'string'
  ) {
    csrfToken = (body as { csrftoken: string }).csrftoken
  }
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** fetch 를 직접 쓸 때(응답을 흘려 받는 요청 등) 붙일 CSRF 헤더 */
export function csrfHeader(): Record<string, string> {
  const token = csrfToken ?? getCookie('csrftoken')
  return token ? { 'X-CSRFToken': token } : {}
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (method !== 'GET') {
    // FormData는 브라우저가 boundary를 포함한 Content-Type을 직접 설정해야 한다
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }
    const token = csrfToken ?? getCookie('csrftoken')
    if (token) headers['X-CSRFToken'] = token
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    let message = `요청 실패 (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body) && body.length > 0) message = String(body[0])
      else if (body && typeof body === 'object') {
        // 필드 검사 오류 {"name": ["..."]} 는 첫 메시지를 보여 준다
        const first = Object.values(body as Record<string, unknown>)[0]
        if (Array.isArray(first) && typeof first[0] === 'string') message = first[0]
      }
    } catch {
      // body가 JSON이 아니면 기본 메시지 유지
    }
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return undefined as T
  const body = (await res.json()) as T
  rememberCsrf(body)
  return body
}
