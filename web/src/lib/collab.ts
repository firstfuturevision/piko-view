// 실시간 공동 편집 연결 (Yjs + y-websocket).
//
// 서버: ws(s)://<host>/ws/collab/<kind>/<id>  (server/apps/docs/collab.py)
//   kind = 'doc'(문서·슬라이드) | 'design'
// 내용 모양·권장 Y 구조는 server/apps/docs/formats.py 를 본다.
//
// 쓰는 법:
//   const c = openCollab('doc', 12)
//   await c.whenSynced()
//   if (!file.has_ystate) seedIfEmpty(c.ydoc, (seed) => { ...snapshot 을 seed 에 옮긴다... })
//   c.onStatus((s) => ...)        // 'connecting' | 'connected' | 'offline' | 'denied'
//   c.onComments(() => reload())  // 댓글이 바뀌면
//   c.destroy()                   // 화면을 떠날 때
import * as decoding from 'lib0/decoding'
import type { Awareness } from 'y-protocols/awareness'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { api } from '../api'
import { API_BASE } from '../api/client'

export type CollabKind = 'doc' | 'design'

/** connecting: 처음 붙는 중, connected: 연결됨, offline: 끊겨서 다시 붙는 중, denied: 권한 없음(다시 붙지 않음) */
export type CollabStatus = 'connecting' | 'connected' | 'offline' | 'denied'

/** awareness 의 user 필드 (커서 이름표) */
export interface CollabUser {
  name: string
  color: string
}

/** 서버가 보내는 댓글 바뀜 알림 (메시지 종류 100) */
export interface CommentsEvent {
  type: 'comments'
  action: 'created' | 'updated' | 'deleted'
  id: number
}

export interface CollabSession {
  ydoc: Y.Doc
  provider: WebsocketProvider
  awareness: Awareness
  /** 지금 상태 */
  status: () => CollabStatus
  /** 서버 내용을 다 받았는지 */
  synced: () => boolean
  onStatus: (cb: (status: CollabStatus) => void) => () => void
  /** 처음 서버 내용을 다 받을 때까지 기다린다 */
  whenSynced: () => Promise<void>
  onComments: (cb: (event: CommentsEvent) => void) => () => void
  destroy: () => void
}

const MSG_COMMENTS = 100
const CLOSE_UNAUTHENTICATED = 4401
const CLOSE_FORBIDDEN = 4403

const CURSOR_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3']

/** 이름으로 늘 같은 커서 색을 고른다 */
export function cursorColor(key: string): string {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length]
}

let meCache: Promise<CollabUser> | null = null

/** 로그인한 사람 (닉네임이 있으면 닉네임) */
function currentUser(): Promise<CollabUser> {
  meCache ??= api
    .getProfile()
    .then((p) => ({ name: p.nickname || p.username, color: cursorColor(p.username) }))
    .catch(() => {
      meCache = null
      return { name: '이름 없음', color: CURSOR_COLORS[0] }
    })
  return meCache
}

/** 웹소켓 기본 주소. API 가 다른 origin(VITE_API_BASE)이면 그쪽으로. */
export function collabBaseUrl(): string {
  const origin = /^https?:\/\//.test(API_BASE) ? new URL(API_BASE).origin : location.origin
  return origin.replace(/^http/, 'ws') + '/ws/collab'
}

export function openCollab(kind: CollabKind, id: number, opts: { user?: CollabUser } = {}): CollabSession {
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(collabBaseUrl(), `${kind}/${id}`, ydoc, {
    // 끊기면 최대 5초 간격으로 다시 붙는다
    maxBackoffTime: 5000,
  })
  const awareness = provider.awareness

  let status: CollabStatus = 'connecting'
  let everConnected = false
  let destroyed = false
  const statusListeners = new Set<(s: CollabStatus) => void>()
  const commentListeners = new Set<(e: CommentsEvent) => void>()

  const setStatus = (next: CollabStatus) => {
    if (status === 'denied' || next === status) return
    status = next
    statusListeners.forEach((cb) => cb(next))
  }

  provider.on('status', ({ status: s }) => {
    if (s === 'connected') {
      everConnected = true
      setStatus('connected')
    } else if (s === 'disconnected' || everConnected) {
      setStatus('offline')
    } else {
      setStatus('connecting')
    }
  })
  // 서버가 4401(로그인 필요)·4403(권한 없음)으로 닫으면 y-websocket 이 다시 붙지 않는다
  provider.on('closed', ({ code }) => {
    if (code === CLOSE_UNAUTHENTICATED || code === CLOSE_FORBIDDEN) setStatus('denied')
  })
  const goOffline = () => setStatus('offline')
  window.addEventListener('offline', goOffline)

  provider.messageHandlers[MSG_COMMENTS] = (_encoder, decoder) => {
    try {
      const event = JSON.parse(decoding.readVarString(decoder)) as CommentsEvent
      commentListeners.forEach((cb) => cb(event))
    } catch {
      // 모르는 형식은 무시
    }
  }

  // 커서 이름표
  const setUser = (user: CollabUser) => awareness.setLocalStateField('user', user)
  if (opts.user) setUser(opts.user)
  else void currentUser().then((u) => { if (!destroyed) setUser(u) })

  return {
    ydoc,
    provider,
    awareness,
    status: () => status,
    synced: () => provider.synced,
    onStatus: (cb) => {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    whenSynced: () =>
      provider.synced
        ? Promise.resolve()
        : new Promise((resolve) => {
            const done = (synced: boolean) => {
              if (!synced) return
              provider.off('sync', done)
              resolve()
            }
            provider.on('sync', done)
          }),
    onComments: (cb) => {
      commentListeners.add(cb)
      return () => commentListeners.delete(cb)
    },
    destroy: () => {
      destroyed = true
      window.removeEventListener('offline', goOffline)
      statusListeners.clear()
      commentListeners.clear()
      provider.destroy()
      ydoc.destroy()
    },
  }
}

/**
 * 서버에 Yjs 내용이 아직 없을 때(has_ystate=false) snapshot 을 한 번만 Yjs 로 옮긴다.
 *
 * clientID 0 인 임시 문서에 같은 순서로 같은 내용을 만들면 누가 하든 똑같은 변경이 되어,
 * 여럿이 동시에 처음 열어도 내용이 두 번 들어가지 않는다. 그러려면 fill 은 같은 입력에서
 * 늘 같은 결과를 만들어야 한다 (무작위 id·현재 시각을 쓰지 않는다).
 * 반드시 whenSynced() 뒤에 부른다. 이미 내용이 있으면 아무것도 하지 않고 false.
 *
 * 문서(TipTap) 예: seedIfEmpty(ydoc, (seed) =>
 *   prosemirrorJSONToYXmlFragment(schema, snapshot, seed.getXmlFragment('default')))
 */
export function seedIfEmpty(ydoc: Y.Doc, fill: (seed: Y.Doc) => void): boolean {
  if (ydoc.store.clients.size > 0) return false
  const seed = new Y.Doc()
  seed.clientID = 0
  fill(seed)
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seed), 'seed')
  seed.destroy()
  return true
}
