export const WHO: Record<string, string> = { human: '사람', agent: '에이전트', system: '시스템', auto: '자동' }

export const TYPE: Record<string, string> = {
  note: '노트', wiki: '위키', md: 'Markdown', txt: '텍스트', pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV',
}

export const STATUS: Record<string, string> = {
  active: '활성', superseded: '구버전', proposed: '승인 대기', rejected: '반려',
}

export const AUTHORED = ['note', 'wiki']

export const fmtDate = (ts: number) =>
  new Date(ts * 1000).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export const fmtShort = (ts: number) => new Date(ts * 1000).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })

export const fileName = (p: string | null) => (p || '').split(/[\\/]/).pop() || ''
