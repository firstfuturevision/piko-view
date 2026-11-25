// 도메인별 API 모듈을 하나의 api 객체로 묶어 내보낸다.
// 사용처는 `import { api } from '../api'` 형태.
import { authApi } from './auth'
import { docsApi } from './docs'
import { kbApi } from './kb'
import { problemsApi } from './problems'
import { schedulesApi } from './schedules'
import { viewApi } from './view'

export const api = {
  ...authApi,
  ...schedulesApi,
  ...problemsApi,
  ...kbApi,
  ...docsApi,
  ...viewApi,
}

export { ADMIN_URL, ApiError } from './client'
export * from './types'
export * from './docs'
export * from './kb'
export * from './view'
