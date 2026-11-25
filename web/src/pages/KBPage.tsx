import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { KBProvider } from '../features/kb/KBContext'
import KBDocPage from '../features/kb/KBDocPage'
import KBHome from '../features/kb/KBHome'
import KBMobileBar from '../features/kb/KBMobileBar'
import KBNewPage from '../features/kb/KBNewPage'
import KBSearchPage from '../features/kb/KBSearchPage'
import KBSidebar from '../features/kb/KBSidebar'

/**
 * 지식 베이스 탭: 왼쪽은 검색·메뉴·문서 트리, 오른쪽은 선택한 화면.
 * 좁은 화면(lg 미만)에서는 트리를 서랍으로 접고, 위쪽 막대의 '문서 목록'으로 연다.
 * 휴대폰(md 미만)에서는 안쪽 스크롤 대신 페이지 전체가 스크롤된다.
 */
export default function KBPage() {
  const location = useLocation()
  // 서랍을 연 화면의 key. 다른 화면으로 이동하면 key 가 바뀌어 저절로 닫힌다
  const [drawerKey, setDrawerKey] = useState<string | null>(null)
  const drawerOpen = drawerKey === location.key
  const closeDrawer = () => setDrawerKey(null)

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <KBProvider>
      <div className="md:flex md:h-full">
        {drawerOpen && (
          <div aria-hidden className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={closeDrawer} />
        )}
        <KBSidebar drawerOpen={drawerOpen} onClose={closeDrawer} />
        <div className="min-w-0 flex-1 md:scroll-pane">
          <KBMobileBar onOpenDrawer={() => setDrawerKey(location.key)} />
          <Routes>
            <Route index element={<KBHome />} />
            <Route path="doc/:id" element={<KBDocPage mode="view" />} />
            <Route path="doc/:id/edit" element={<KBDocPage mode="edit" />} />
            <Route path="new" element={<KBNewPage />} />
            <Route path="search" element={<KBSearchPage />} />
            <Route path="*" element={<KBHome />} />
          </Routes>
        </div>
      </div>
    </KBProvider>
  )
}
