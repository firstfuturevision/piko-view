import { Link } from 'react-router-dom'
import type { DocSummary } from '../../api'
import { SelectBox } from '../../components/ui/bulkSelect'
import type { BulkSelect } from '../../components/ui/useBulkSelect'
import type { ContextMenuControl } from '../../components/ui/useContextMenu'
import { docPath, KIND_EMOJI, KIND_LABEL, locationLabel, timeAgo } from './docUtils'

interface Props {
  doc: DocSummary
  /** 우클릭·⋯ 버튼으로 띄우는 메뉴 (useDocFileMenu) */
  menu: ContextMenuControl<DocSummary>
  /** 위치 표시(내 파일·프로젝트 이름)를 보일지 */
  showLocation?: boolean
  compact?: boolean
  /** 여러 개 고르기 (문서 목록 화면에서만) */
  bulk?: BulkSelect<DocSummary>
}

/** 문서·슬라이드 카드: 미리보기 · 이름 · 주인 · 고친 때 */
export default function DocCard({ doc, menu, showLocation = true, compact = false, bulk }: Props) {
  const slides = doc.kind === 'slides'
  const picked = bulk?.isSelected(doc) ?? false
  return (
    <li
      className="group relative"
      onContextMenu={menu.onContextMenu(doc, { links: false })}
      {...bulk?.cardProps(doc)}
    >
      {bulk && <SelectBox bulk={bulk} item={doc} label={doc.title || '제목 없음'} />}
      <Link
        to={docPath(doc)}
        data-tip="눌러서 엽니다. 우클릭하면 새 탭·링크 복사·이름 바꾸기·공유·옮기기·삭제 메뉴가 뜹니다"
        className={`block overflow-hidden rounded-xl border bg-white transition hover:border-blue-300 hover:shadow-sm ${
          picked ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200/80'
        }`}
      >
        <div
          className={`relative grid place-items-center overflow-hidden border-b border-slate-100 bg-slate-100/70 ${
            compact ? 'aspect-[16/10]' : 'aspect-[4/3]'
          }`}
        >
          {doc.thumbnail ? (
            <img
              src={doc.thumbnail}
              alt=""
              className={
                slides
                  ? 'absolute inset-0 h-full w-full object-contain p-3'
                  : 'absolute top-3 left-1/2 w-[72%] -translate-x-1/2 rounded-t-sm shadow-sm ring-1 ring-slate-200'
              }
            />
          ) : (
            <span className="text-3xl opacity-70" aria-hidden>
              {KIND_EMOJI[doc.kind]}
            </span>
          )}
          <span
            className={`absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              slides ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
            }`}
          >
            {KIND_LABEL[doc.kind]}
          </span>
        </div>
        <div className="px-3 py-2 pr-9">
          <p className="truncate text-sm font-medium text-slate-800">{doc.title || '제목 없음'}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {showLocation && (
              <span className={doc.project ? '' : 'text-slate-500'}>
                {doc.project ? '📁 ' : doc.can_manage ? '🔒 ' : '👥 '}
                {locationLabel(doc)} ·{' '}
              </span>
            )}
            {doc.owner_name ? `${doc.owner_name} · ` : ''}
            {timeAgo(doc.updated_at)}
          </p>
        </div>
      </Link>
      <button
        type="button"
        aria-label={`${doc.title} 메뉴`}
        data-tip="이름 바꾸기·복제·공유·옮기기·삭제"
        aria-haspopup="menu"
        data-bulk-skip
        onClick={(e) => menu.openFrom(doc, e.currentTarget)}
        className="absolute right-2 bottom-2.5 rounded-md px-1.5 py-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        ⋯
      </button>
    </li>
  )
}
