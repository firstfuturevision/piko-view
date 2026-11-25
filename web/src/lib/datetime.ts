export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toLocalDateInput(iso: string | null): string {
  if (!iso) return ''
  return dateKey(new Date(iso))
}

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Date → datetime-local 입력값 (YYYY-MM-DDTHH:mm) */
export function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 로컬 기준 YYYY-MM-DD 키 (캘린더 날짜 매칭용) */
export function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 목록·카드에 넣을 짧은 날짜: '10/12' (YYYY-MM-DD 는 그날 자정으로 본다) */
export function shortDate(value: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00` : value)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
