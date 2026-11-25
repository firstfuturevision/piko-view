import { request } from './client'

// 문서·슬라이드, 댓글, 템플릿. 내용(JSON) 모양은 server/apps/docs/formats.py 참고.
// 실시간 편집 연결은 src/lib/collab.ts.

/** 문서·디자인 파일 공통: 주인과 공유 */
export interface FileOwnership {
  owner: number | null
  owner_name: string
  /** 공유받은 사람 (개인 파일일 때만 의미가 있다) */
  shared_with_users: { id: number; name: string }[]
  /** 내가 주인(또는 관리자)이라 공유·개인↔프로젝트 옮기기·(개인 파일) 지우기를 할 수 있는지 */
  can_manage: boolean
}

export type DocKind = 'doc' | 'slides'

/** 목록에 보이는 문서 (snapshot 은 빠져 있다) */
export interface DocSummary extends FileOwnership {
  id: number
  kind: DocKind
  title: string
  project: number | null
  project_name: string | null
  /** 미리보기 (PNG data URL, 없으면 빈 글) */
  thumbnail: string
  updated_by_name: string
  created_at: string
  updated_at: string
}

export interface DocDetail extends DocSummary {
  /** 마지막으로 보낸 보통 JSON 사본 (문서: TipTap JSON, 슬라이드: {version, size, slides}) */
  snapshot: Record<string, unknown>
  /** 서버에 실시간 편집(Yjs) 내용이 있는지. 없으면 편집기가 snapshot 을 Yjs 로 옮긴다 */
  has_ystate: boolean
}

export interface DocListParams {
  kind?: DocKind
  /** 'mine' = 내 개인 파일 + 공유받은 파일 */
  scope?: 'mine'
  project?: number
}

export interface DocAsset {
  id: number
  doc: number
  name: string
  url: string
  width: number | null
  height: number | null
  uploaded_at: string
}

export type CommentTargetKind = 'doc' | 'design'

export interface FileComment {
  id: number
  target_kind: CommentTargetKind
  target_id: number
  /** 문서: {mark} 또는 {relpos, quote}, 슬라이드·디자인: {page, x, y, node?} */
  anchor: Record<string, unknown>
  body: string
  author: number | null
  author_name: string
  is_mine: boolean
  /** 답글이면 원 댓글 id (한 단계) */
  parent: number | null
  resolved: boolean
  resolved_by_name: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export type TemplateKind = 'doc' | 'slides' | 'design'

export interface FileTemplateSummary {
  id: number
  kind: TemplateKind
  name: string
  description: string
  builtin: boolean
  owner: number | null
  owner_name: string
  can_manage: boolean
  thumbnail: string
  created_at: string
}

export interface FileTemplate extends FileTemplateSummary {
  content: Record<string, unknown>
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const docsApi = {
  // ---------- 문서·슬라이드 ----------
  listDocs: (params: DocListParams = {}) => request<DocSummary[]>(`/docs/${query({ ...params })}`),
  getDoc: (id: number) => request<DocDetail>(`/docs/${id}/`),
  createDoc: (data: { kind: DocKind; title: string; project?: number | null; snapshot?: Record<string, unknown> }) =>
    request<DocDetail>('/docs/', post(data)),
  /** 제목·프로젝트 바꾸기, snapshot·미리보기 저장 (실시간 편집 중 몇 초~수십 초마다) */
  updateDoc: (
    id: number,
    changes: { title?: string; project?: number | null; snapshot?: Record<string, unknown>; thumbnail?: string },
  ) => request<DocDetail>(`/docs/${id}/`, { method: 'PATCH', body: JSON.stringify(changes) }),
  deleteDoc: (id: number) => request<void>(`/docs/${id}/`, { method: 'DELETE' }),
  duplicateDoc: (id: number) => request<DocSummary>(`/docs/${id}/duplicate/`, post()),
  shareDoc: (id: number, userIds: number[]) => request<DocSummary>(`/docs/${id}/share/`, post({ user_ids: userIds })),
  unshareDoc: (id: number, userIds: number[]) =>
    request<DocSummary>(`/docs/${id}/unshare/`, post({ user_ids: userIds })),
  saveDocAsTemplate: (id: number, data: { name: string; description?: string }) =>
    request<FileTemplate>(`/docs/${id}/save-template/`, post(data)),
  uploadDocAsset: (docId: number, file: File, width?: number, height?: number) => {
    const form = new FormData()
    form.append('doc', String(docId))
    form.append('file', file)
    if (width) form.append('width', String(Math.round(width)))
    if (height) form.append('height', String(Math.round(height)))
    return request<DocAsset>('/doc-assets/', { method: 'POST', body: form })
  },
  deleteDocAsset: (id: number) => request<void>(`/doc-assets/${id}/`, { method: 'DELETE' }),

  // ---------- 댓글 ----------
  listComments: (kind: CommentTargetKind, id: number, opts: { resolved?: boolean } = {}) =>
    request<FileComment[]>(
      `/comments/${query({ kind, id, resolved: opts.resolved === undefined ? undefined : opts.resolved ? 1 : 0 })}`,
    ),
  createComment: (data: {
    target_kind: CommentTargetKind
    target_id: number
    body: string
    anchor?: Record<string, unknown>
    parent?: number | null
  }) => request<FileComment>('/comments/', post(data)),
  /** 내가 쓴 댓글만 */
  updateComment: (id: number, changes: { body?: string; anchor?: Record<string, unknown> }) =>
    request<FileComment>(`/comments/${id}/`, { method: 'PATCH', body: JSON.stringify(changes) }),
  /** 내가 쓴 댓글만 (답글도 함께 지워진다) */
  deleteComment: (id: number) => request<void>(`/comments/${id}/`, { method: 'DELETE' }),
  resolveComment: (id: number) => request<FileComment>(`/comments/${id}/resolve/`, post()),
  reopenComment: (id: number) => request<FileComment>(`/comments/${id}/reopen/`, post()),

  // ---------- 템플릿 ----------
  listTemplates: (kind?: TemplateKind) => request<FileTemplateSummary[]>(`/templates/${query({ kind })}`),
  getTemplate: (id: number) => request<FileTemplate>(`/templates/${id}/`),
  createTemplate: (data: { kind: TemplateKind; name: string; description?: string; content: Record<string, unknown>; thumbnail?: string }) =>
    request<FileTemplate>('/templates/', post(data)),
  deleteTemplate: (id: number) => request<void>(`/templates/${id}/`, { method: 'DELETE' }),
  /** 템플릿으로 새 파일 만들기 */
  createFromTemplate: (id: number, data: { title?: string; project?: number | null } = {}) =>
    request<DocSummary>(`/templates/${id}/use/`, post(data)),
}
