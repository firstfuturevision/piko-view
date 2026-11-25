import type { DocKind, DocSummary } from '../../api'

/** 문서는 /docs/<id> 편집기에서 연다 */
export function docPath(doc: { id: number; kind?: DocKind }): string {
  return `/docs/${doc.id}`
}

export const KIND_LABEL: Record<DocKind, string> = { doc: '문서', slides: '슬라이드' }
export const KIND_EMOJI: Record<DocKind, string> = { doc: '📄', slides: '📊' }

export { ago as timeAgo } from '../../lib/format'

/** 위치 표시: 프로젝트 이름 또는 '내 파일'(공유받은 것은 '공유받음') */
export function locationLabel(doc: Pick<DocSummary, 'project' | 'project_name' | 'can_manage'>): string {
  if (doc.project) return doc.project_name ?? '프로젝트'
  return doc.can_manage ? '내 파일' : '공유받음'
}

export { errText as errorText } from '../../lib/errors'
