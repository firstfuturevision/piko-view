import { ApiError } from '../api/client'

/** 서버에 아직 이 기능이 없음 (404) */
export function isNotReady(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404
}

/**
 * 오류를 화면에 보일 한 줄로. 메시지가 없으면 fallback.
 * what 을 주면 서버 준비 전(404)일 때 '<what>: 서버 준비 중입니다.' 로 바꾼다.
 */
export function errText(e: unknown, fallback = '처리하지 못했습니다.', what?: string): string {
  if (what && isNotReady(e)) return `${what}: 서버 준비 중입니다.`
  return e instanceof Error && e.message ? e.message : fallback
}
