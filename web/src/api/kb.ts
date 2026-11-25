import { API_BASE, request } from './client'

export type KBStatus = 'active' | 'superseded' | 'proposed' | 'rejected'

export interface KBTreeItem {
  id: string
  title: string
  doc_type: string
  parent_id: string | null
  position: number
  status: KBStatus
  created_by: string
  updated_at: number
}

export interface KBLink {
  direction: 'out' | 'in'
  kind: 'references' | 'supersedes'
  other_id: string
  other_title: string
  other_status: KBStatus
  note: string
  created_by: string
}

export interface KBDocument {
  id: string
  title: string
  doc_type: string
  status: KBStatus
  created_by: string
  author: string
  parent_id: string | null
  path: string
  body: string
  tags: string[]
  links: KBLink[]
  total_chunks: number
  ancestors: { id: string; title: string }[]
  children: { id: string; title: string; doc_type: string; status: KBStatus }[]
  chunks: { ord: number; heading: string; text: string }[]
  source_path: string | null
  md_path: string | null
  created_at: number
  updated_at: number
  edited_at: number | null
}

export interface KBSearchHit {
  doc_id: string
  title: string
  path: string
  doc_type: string
  chunk_ord: number
  heading: string
  text: string
  score: number
  via: ('keyword' | 'vector')[]
}

export interface KBGraphNode {
  id: string
  label: string
  type: string
  doc_type: string
  status: KBStatus
  parent_id: string | null
  created_by: string
}

export interface KBGraphEdge {
  id: string
  source: string
  target: string
  kind: 'child' | 'references' | 'supersedes' | 'similar'
  weight?: number
}

export interface KBGraph {
  nodes: KBGraphNode[]
  edges: KBGraphEdge[]
  center?: string
  similarity?: string | null
}

export interface KBStats {
  documents: Partial<Record<KBStatus, number>>
  chunks: number
  embedded_chunks: number
  embedder: string
  embedder_state: 'disabled' | 'idle' | 'loading' | 'ready' | 'error'
  /** 모델을 못 불러온 이유 */
  embedder_error?: string
  searches: number
  empty_searches: number
  allowed_roots: string[]
  tools: number
}

export interface KBPendingWiki {
  id: string
  title: string
  created_by: string
  author: string
  created_at: number
  text: string
}

export interface KBImportResult {
  status: 'added' | 'updated' | 'duplicate' | 'existing' | 'error'
  doc_id?: string
  title?: string
  parent_id?: string | null
  path?: string
  error?: string
}

export interface KBAttachment {
  name: string
  url?: string
  size?: number
  kind?: 'image' | 'file'
  markdown?: string
  error?: string
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const kbApi = {
  kbStatus: () => request<KBStats>('/kb/status/'),
  /** 임베딩 모델 불러오기를 다시 시도 */
  kbEmbedRetry: () => request<KBStats>('/kb/embed/retry/', { method: 'POST' }),
  kbTree: () => request<KBTreeItem[]>('/kb/tree/'),
  kbDocument: (id: string) => request<KBDocument>(`/kb/documents/${encodeURIComponent(id)}/`),
  /** 저장 전 글과 비슷한 기존 문서 (새 문서 중복 경고) */
  kbSimilarDraft: (title: string, body: string, exclude?: string) =>
    post<{ similar: { doc_id: string; title: string; path: string; similarity: number }[]; method: string }>(
      '/kb/similar/',
      { title, body, exclude },
    ),
  kbCreateNote: (title: string, body: string, parentId: string | null) =>
    post<{ doc_id: string; title: string }>('/kb/notes/', { title, body, parent_id: parentId }),
  kbUpdateContent: (id: string, title: string, body: string) =>
    request<{ doc_id: string; title: string }>(`/kb/documents/${id}/content/`, {
      method: 'PUT',
      body: JSON.stringify({ title, body }),
    }),
  kbDelete: (id: string) =>
    request<{ deleted: string; children_moved_up: number }>(`/kb/documents/${id}/`, { method: 'DELETE' }),
  kbMove: (id: string, parentId: string | null, index: number | null) =>
    post<{ doc_id: string }>(`/kb/documents/${id}/move/`, { parent_id: parentId, index }),
  kbTags: (id: string, add: string[], remove: string[]) =>
    post<{ tags: string[] }>(`/kb/documents/${id}/tags/`, { add, remove }),
  kbRelated: (id: string) =>
    request<{ similar: { doc_id: string; title: string; path: string; similarity: number }[] }>(
      `/kb/documents/${id}/related/`,
    ),
  kbLocalGraph: (id: string, depth: number) => request<KBGraph>(`/kb/documents/${id}/graph/?depth=${depth}`),
  kbGraph: (similar: boolean) => request<KBGraph>(`/kb/graph/?similar=${similar ? 1 : 0}`),
  kbSearch: (query: string, mode: string, limit = 12) =>
    post<KBSearchHit[]>('/kb/search/', { query, mode, limit }),
  kbUpload: (files: File[], parentId: string | null) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    if (parentId) form.append('parent_id', parentId)
    return request<KBImportResult[]>('/kb/upload/', { method: 'POST', body: form })
  },
  kbAttach: (files: File[]) => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    return request<KBAttachment[]>('/kb/attachments/', { method: 'POST', body: form })
  },
  kbPendingWiki: () => request<KBPendingWiki[]>('/kb/wiki/?status=proposed'),
  kbReviewWiki: (id: string, approve: boolean) => post<{ status: string }>(`/kb/wiki/${id}/review/`, { approve }),
}

/** 본문의 첨부 링크(files/<해시>/<이름>)를 인증된 API 경로로 바꾼다. */
export function kbFileUrl(relative: string): string {
  return `${API_BASE}/kb/${relative}`
}
