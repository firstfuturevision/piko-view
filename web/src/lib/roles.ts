/** 내 정보의 역할 글을 한 줄로: 줄바꿈은 ' · ' 로 잇고 길면 줄인다 (전체는 마우스를 올리면 보이게 title 로) */
export function shortRole(role: string | null | undefined, max = 40): string {
  const one = (role ?? '').split('\n').map((s) => s.trim()).filter(Boolean).join(' · ')
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}
