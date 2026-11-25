import { prosemirrorJSONToYXmlFragment } from '@tiptap/y-tiptap'
import { useEffect, useState } from 'react'
import { api, ApiError, type DocDetail } from '../../../api'
import { cursorColor, openCollab, seedIfEmpty, type CollabSession, type CollabStatus, type CollabUser } from '../../../lib/collab'
import { docSchema } from './extensions'

export type LoadState =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'notfound' }
  /** 슬라이드는 슬라이드 편집기에서 연다 (문서 편집기가 슬라이드 내용을 건드리지 않게) */
  | { state: 'slides' }
  | { state: 'ready'; doc: DocDetail; session: CollabSession; me: CollabUser }

/**
 * 문서를 불러오고 공동 편집 방에 붙는다.
 * 서버 내용을 다 받은 뒤에(whenSynced) 편집기를 만들고, 서버에 Yjs 내용이 없으면(has_ystate=false)
 * snapshot 을 한 번만 Yjs 로 옮긴다 (여럿이 동시에 열어도 겹치지 않게 seedIfEmpty).
 * 문서가 바뀌면 화면을 key 로 새로 만든다 (docId 가 바뀌어도 상태를 되돌리지 않는다).
 */
export function useDocSession(docId: number) {
  const [load, setLoad] = useState<LoadState>({ state: 'loading' })
  const [status, setStatus] = useState<CollabStatus>('connecting')

  useEffect(() => {
    let alive = true
    let session: CollabSession | null = null

    ;(async () => {
      try {
        const [doc, profile] = await Promise.all([api.getDoc(docId), api.getProfile()])
        if (!alive) return
        if (doc.kind !== 'doc') {
          setLoad({ state: 'slides' })
          return
        }
        const me: CollabUser = { name: profile.nickname || profile.username, color: cursorColor(profile.username) }
        const s = openCollab('doc', docId, { user: me })
        session = s
        s.onStatus((next) => alive && setStatus(next))
        await s.whenSynced()
        if (!alive) return
        if (!doc.has_ystate && doc.snapshot && (doc.snapshot as { type?: string }).type === 'doc') {
          try {
            seedIfEmpty(s.ydoc, (seed) =>
              prosemirrorJSONToYXmlFragment(docSchema(), doc.snapshot, seed.getXmlFragment('default')),
            )
          } catch {
            // 모양이 맞지 않는 옛 내용은 건너뛰고 빈 문서로 시작한다
          }
        }
        setLoad({ state: 'ready', doc, session: s, me })
      } catch (e) {
        if (!alive) return
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setLoad({ state: 'notfound' })
        else setLoad({ state: 'error', message: e instanceof Error ? e.message : '문서를 불러오지 못했습니다.' })
      }
    })()

    return () => {
      alive = false
      session?.destroy()
    }
  }, [docId])

  // 권한이 없어 서버가 연결을 끊었는데 아직 내용을 못 받았으면 기다리지 않는다
  const denied = status === 'denied'
  return { load, status, denied }
}
