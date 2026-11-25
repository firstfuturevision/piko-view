// 화면 전체가 같이 쓰는 시각 표기.
//
// 시각 규칙:
//   when — '11. 4. 오후 03:30' 처럼 월·일·시·분 (비면 empty 값)
//   ago  — '방금' · '5분 전' · '3시간 전' · '2일 전' (7일이 넘으면 날짜, 앞날이면 '… 예정')

function toDate(v: string | number): Date {
  // 숫자는 유닉스 초 (서버 관리 API)
  return typeof v === 'number' ? new Date(v * 1000) : new Date(v)
}

/** 월·일·시·분: '11. 4. 오후 03:30' */
export function when(v: string | number | null | undefined, empty = ''): string {
  if (v === null || v === undefined || v === '') return empty
  return toDate(v).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 지금부터의 거리: '방금' · '5분 전' · '3시간 전' · '2일 전' · 7일이 넘으면 날짜 */
export function ago(v: string | number | null | undefined, empty = ''): string {
  if (v === null || v === undefined || v === '') return empty
  const sec = Math.round((Date.now() - toDate(v).getTime()) / 1000)
  if (sec < -60) return `${when(v)} 예정`
  if (sec < 60) return '방금'
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}일 전`
  return toDate(v).toLocaleDateString('ko-KR')
}
